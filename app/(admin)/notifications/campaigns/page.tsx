"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type CampaignRow = {
  id: string;
  created_at: string;
  created_by: string | null;
  mode: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  criteria: Record<string, unknown>;
  recipient_count: number;
};

type DeliveryAgg = {
  campaign_id: string;
  total: number;
  pending: number;
  ok: number;
  failed: number;
};

type ModeKey =
  | "all_users"
  | "raffle_users"
  | "selected_customers"
  | "attempt_status"
  | "multi_raffle_union"
  | "unknown";

function toModeKey(v: string): ModeKey {
  const x = (v ?? "").trim();
  if (
    x === "all_users" ||
    x === "raffle_users" ||
    x === "selected_customers" ||
    x === "attempt_status" ||
    x === "multi_raffle_union"
  ) {
    return x;
  }
  return "unknown";
}

function modeLabel(mode: string): string {
  switch (toModeKey(mode)) {
    case "all_users":
      return "All users";
    case "raffle_users":
      return "Raffle participants";
    case "selected_customers":
      return "Selected customers";
    case "attempt_status":
      return "Attempt status";
    case "multi_raffle_union":
      return "Union of multiple raffles";
    default:
      return mode || "Unknown";
  }
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function formatShortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

function formatDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IE");
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "neutral" | "good" | "warn" | "bad";
}) {
  const styles = (() => {
    if (tone === "good") {
      return { bg: "#ECFDF5", border: "#6EE7B7", text: "#065F46" };
    }
    if (tone === "warn") {
      return { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" };
    }
    if (tone === "bad") {
      return { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B" };
    }
    return {
      bg: COLORS.highlightCardBg,
      border: COLORS.cardBorder,
      text: COLORS.textSecondary,
    };
  })();

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
      style={{
        backgroundColor: styles.bg,
        borderColor: styles.border,
        color: styles.text,
      }}
    >
      <span className="font-semibold">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function parseUuidArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => safeString(x)).filter(Boolean);
  if (typeof v === "string")
    return v
      .split(/[\s,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
  return [];
}

export default function CampaignsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pagination
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [aggs, setAggs] = useState<Record<string, DeliveryAgg>>({});

  // Filters
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<ModeKey | "all">("all");
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all">("7d");

  // Human-friendly resolvers
  const [raffleNameById, setRaffleNameById] = useState<Record<string, string>>(
    {}
  );

  const timeMinIso = useMemo(() => {
    if (range === "all") return null;
    const now = new Date();
    if (range === "today") {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    const days = range === "7d" ? 7 : 30;
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }, [range]);

  const normalizeCampaign = useCallback((row: unknown): CampaignRow => {
    const obj = (row ?? {}) as Record<string, unknown>;
    return {
      id: safeString(obj["id"]),
      created_at: safeString(obj["created_at"]),
      created_by: obj["created_by"] ? safeString(obj["created_by"]) : null,
      mode: safeString(obj["mode"]),
      title: safeString(obj["title"]),
      body: safeString(obj["body"]),
      data: isObject(obj["data"])
        ? (obj["data"] as Record<string, unknown>)
        : {},
      criteria: isObject(obj["criteria"])
        ? (obj["criteria"] as Record<string, unknown>)
        : {},
      recipient_count:
        typeof obj["recipient_count"] === "number"
          ? (obj["recipient_count"] as number)
          : Number(obj["recipient_count"] ?? 0),
    };
  }, []);

  const fetchAggsFor = useCallback(
    async (campaignIds: string[]) => {
      if (campaignIds.length === 0) return;

      const { data, error } = await supabase
        .from("admin_notification_deliveries")
        .select("campaign_id,push_attempted,push_ok")
        .in("campaign_id", campaignIds);

      if (error) throw error;

      const rows = Array.isArray(data) ? (data as unknown[]) : [];
      const next: Record<string, DeliveryAgg> = { ...aggs };

      for (const r of rows) {
        const obj = (r ?? {}) as Record<string, unknown>;
        const campaign_id = safeString(obj["campaign_id"]);
        if (!campaign_id) continue;

        const push_attempted = Boolean(obj["push_attempted"]);
        const push_ok = Boolean(obj["push_ok"]);

        if (!next[campaign_id]) {
          next[campaign_id] = {
            campaign_id,
            total: 0,
            pending: 0,
            ok: 0,
            failed: 0,
          };
        }

        next[campaign_id].total += 1;
        if (!push_attempted) next[campaign_id].pending += 1;
        else if (push_ok) next[campaign_id].ok += 1;
        else next[campaign_id].failed += 1;
      }

      setAggs(next);
    },
    [aggs]
  );

  const resolveRaffleNames = useCallback(
    async (raffleIds: string[]) => {
      const unknown = raffleIds.filter((id) => id && !raffleNameById[id]);
      if (unknown.length === 0) return;

      const { data, error } = await supabase
        .from("raffles")
        .select("id,item_name")
        .in("id", unknown)
        .limit(200);

      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];
      const next = { ...raffleNameById };

      for (const r of list) {
        const obj = (r ?? {}) as Record<string, unknown>;
        const id = safeString(obj["id"]);
        const name = safeString(obj["item_name"]);
        if (id && name) next[id] = name;
      }

      setRaffleNameById(next);
    },
    [raffleNameById]
  );

  const summarizeCriteriaHuman = useCallback(
    (mode: string, criteria: Record<string, unknown>): string => {
      const mk = toModeKey(mode);

      const raffleId = safeString(criteria["raffle_id"]);
      const raffleIds = parseUuidArray(criteria["raffle_ids"]);
      const customerIds = parseUuidArray(criteria["customer_ids"]);
      const attemptPassed = criteria["attempt_passed"];
      const onlyCompleted = criteria["only_completed_tickets"];

      const onlyCompletedText =
        typeof onlyCompleted === "boolean"
          ? onlyCompleted
            ? "Completed tickets only"
            : "All tickets"
          : "Completed tickets only";

      const raffleName = raffleId ? raffleNameById[raffleId] : null;

      if (mk === "all_users") return "Everyone";

      if (mk === "raffle_users") {
        const label = raffleName
          ? raffleName
          : raffleId
          ? formatShortId(raffleId)
          : "—";
        return `Raffle: ${label} • ${onlyCompletedText}`;
      }

      if (mk === "multi_raffle_union") {
        const names = raffleIds
          .map((id) => raffleNameById[id])
          .filter(Boolean)
          .slice(0, 3) as string[];

        const remainder = Math.max(raffleIds.length - names.length, 0);
        const nameText =
          names.length > 0
            ? `${names.join(", ")}${remainder ? ` +${remainder} more` : ""}`
            : `${raffleIds.length || "—"} raffles`;

        return `Raffles: ${nameText} • ${onlyCompletedText}`;
      }

      if (mk === "selected_customers") {
        return `Selected customers: ${customerIds.length || "—"}`;
      }

      if (mk === "attempt_status") {
        const passedText =
          typeof attemptPassed === "boolean"
            ? attemptPassed
              ? "Passed"
              : "Failed"
            : "Passed/Failed";
        const scope = raffleName
          ? raffleName
          : raffleId
          ? formatShortId(raffleId)
          : "All raffles";
        return `${passedText} • Scope: ${scope}`;
      }

      return "—";
    },
    [raffleNameById]
  );

  const loadPage = useCallback(
    async (opts: { reset: boolean }) => {
      setErrorMsg(null);
      setLoading(true);

      try {
        const nextPage = opts.reset ? 0 : page;
        const from = nextPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let q = supabase
          .from("admin_notification_campaigns")
          .select(
            "id,created_at,created_by,mode,title,body,data,criteria,recipient_count"
          )
          .order("created_at", { ascending: false })
          .range(from, to);

        if (timeMinIso) q = q.gte("created_at", timeMinIso);
        if (modeFilter !== "all") q = q.eq("mode", modeFilter);

        const s = search.trim();
        if (s) q = q.or(`title.ilike.%${s}%,body.ilike.%${s}%`);

        const { data, error } = await q;
        if (error) throw error;

        const list = Array.isArray(data) ? data : [];
        const normalized = list.map(normalizeCampaign);

        // Resolve raffle IDs found in criteria for more human display
        const raffleIdsToResolve: string[] = [];
        for (const c of normalized) {
          const cr = c.criteria ?? {};
          const rid = safeString(cr["raffle_id"]);
          if (rid) raffleIdsToResolve.push(rid);
          const rids = parseUuidArray(cr["raffle_ids"]);
          raffleIdsToResolve.push(...rids);
        }
        const uniqRaffleIds = Array.from(
          new Set(raffleIdsToResolve.filter(Boolean))
        );
        if (uniqRaffleIds.length) await resolveRaffleNames(uniqRaffleIds);

        if (opts.reset) {
          setCampaigns(normalized);
          setPage(1);
        } else {
          setCampaigns((prev) => {
            const merged = [...prev, ...normalized];
            const map = new Map<string, CampaignRow>();
            for (const c of merged) map.set(c.id, c);
            return Array.from(map.values()).sort((a, b) =>
              a.created_at < b.created_at ? 1 : -1
            );
          });
          setPage((p) => p + 1);
        }

        setHasMore(normalized.length === PAGE_SIZE);
        await fetchAggsFor(normalized.map((c) => c.id));
      } catch (e: unknown) {
        setErrorMsg(
          e instanceof Error ? e.message : "Failed to load campaigns."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      PAGE_SIZE,
      fetchAggsFor,
      modeFilter,
      normalizeCampaign,
      page,
      search,
      timeMinIso,
      resolveRaffleNames,
    ]
  );

  // Reset on filter changes
  useEffect(() => {
    setHasMore(true);
    setPage(0);
    void loadPage({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, modeFilter, range]);

  const refresh = useCallback(async () => {
    setHasMore(true);
    setPage(0);
    await loadPage({ reset: true });
  }, [loadPage]);

  const rows = useMemo(() => {
    return campaigns.map((c) => {
      const a = aggs[c.id];
      const total = a?.total ?? c.recipient_count ?? 0;
      const pending = a?.pending ?? 0;
      const ok = a?.ok ?? 0;
      const failed = a?.failed ?? 0;
      return { c, total, pending, ok, failed };
    });
  }, [campaigns, aggs]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: COLORS.textPrimary }}
          >
            Campaigns
          </h1>
          <p className="text-sm mt-1" style={{ color: COLORS.textMuted }}>
            Click a campaign to open its audit view (deliveries, failures,
            export).
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          className="rounded px-4 py-2 text-sm font-semibold"
          style={{
            backgroundColor: COLORS.primaryButtonBg,
            color: COLORS.primaryButtonText,
            opacity: loading ? 0.7 : 1,
          }}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div
        className="rounded-2xl border p-4 space-y-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label
              className="block text-xs font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              Search
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or body…"
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
          </div>

          <div>
            <label
              className="block text-xs font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              Mode
            </label>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as ModeKey | "all")}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="all">All</option>
              <option value="all_users">All users</option>
              <option value="raffle_users">Raffle participants</option>
              <option value="selected_customers">Selected customers</option>
              <option value="attempt_status">Attempt status</option>
              <option value="multi_raffle_union">
                Union of multiple raffles
              </option>
            </select>
          </div>

          <div>
            <label
              className="block text-xs font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              Time range
            </label>
            <select
              value={range}
              onChange={(e) =>
                setRange(e.target.value as "today" | "7d" | "30d" | "all")
              }
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        {errorMsg && (
          <div
            className="rounded px-4 py-3 text-sm border"
            style={{
              backgroundColor: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: COLORS.error,
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* List */}
        <div
          className="xl:col-span-2 rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
          }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: COLORS.cardBorder }}
          >
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Campaigns ({rows.length})
            </div>

            <button
              type="button"
              onClick={() => void loadPage({ reset: true })}
              className="rounded px-3 py-1.5 text-xs font-semibold border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.screenBg,
                color: COLORS.textSecondary,
              }}
              disabled={loading}
            >
              {loading ? "Loading…" : "Reload list"}
            </button>
          </div>

          {rows.length === 0 ? (
            <div
              className="px-4 py-6 text-sm"
              style={{ color: COLORS.textMuted }}
            >
              No campaigns found for the current filters.
            </div>
          ) : (
            <div
              className="divide-y"
              style={{ borderColor: COLORS.cardBorder }}
            >
              {rows.map(({ c, total, pending, ok, failed }) => {
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      router.push(`/notifications/campaigns/${c.id}`)
                    }
                    className="w-full text-left px-4 py-4 transition"
                    style={{
                      backgroundColor: COLORS.cardBg,
                      color: COLORS.textPrimary,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold truncate">
                            {c.title || "Untitled"}
                          </div>
                          <span
                            className="text-[0.7rem] uppercase tracking-wide px-2 py-1 rounded-full border"
                            style={{
                              color: COLORS.textSecondary,
                              borderColor: COLORS.cardBorder,
                              backgroundColor: COLORS.screenBg,
                            }}
                          >
                            {modeLabel(c.mode)}
                          </span>
                        </div>

                        <div
                          className="text-xs mt-1"
                          style={{ color: COLORS.textMuted }}
                        >
                          {summarizeCriteriaHuman(c.mode, c.criteria ?? {})}
                        </div>

                        <div
                          className="text-xs mt-2"
                          style={{ color: COLORS.textMuted }}
                        >
                          {timeAgo(c.created_at)} • {formatDate(c.created_at)} •
                          ID: {formatShortId(c.id)}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div
                          className="text-sm font-semibold"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {total}
                        </div>
                        <div
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textMuted }}
                        >
                          recipients
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Chip
                        label="Pending"
                        value={pending}
                        tone={pending > 0 ? "warn" : "neutral"}
                      />
                      <Chip
                        label="OK"
                        value={ok}
                        tone={ok > 0 ? "good" : "neutral"}
                      />
                      <Chip
                        label="Failed"
                        value={failed}
                        tone={failed > 0 ? "bad" : "neutral"}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div
            className="px-4 py-4 border-t"
            style={{ borderColor: COLORS.cardBorder }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Showing {rows.length}{" "}
                {rows.length === 1 ? "campaign" : "campaigns"}
              </div>

              <button
                type="button"
                onClick={() => void loadPage({ reset: false })}
                disabled={loading || !hasMore}
                className="rounded px-4 py-2 text-sm font-semibold"
                style={{
                  backgroundColor: COLORS.primaryButtonBg,
                  color: COLORS.primaryButtonText,
                  opacity: loading || !hasMore ? 0.55 : 1,
                }}
              >
                {hasMore
                  ? loading
                    ? "Loading…"
                    : "Load more"
                  : "No more results"}
              </button>
            </div>
          </div>
        </div>

        {/* Right panel: instructions */}
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
          }}
        >
          <div
            className="text-sm font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            How to use
          </div>

          <div className="text-sm" style={{ color: COLORS.textSecondary }}>
            Click any campaign to open its audit view. There you can:
          </div>

          <ul
            className="list-disc pl-5 text-sm space-y-1"
            style={{ color: COLORS.textSecondary }}
          >
            <li>See per-recipient delivery outcomes</li>
            <li>Filter pending / OK / failed</li>
            <li>Export deliveries to CSV</li>
            <li>Copy campaign ID for support/debugging</li>
          </ul>

          <div
            className="rounded-xl border p-3 text-xs"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.screenBg,
              color: COLORS.textMuted,
            }}
          >
            Tip: Use “Search” + “Mode” + “Time range” to find a specific send
            quickly.
          </div>
        </div>
      </div>
    </div>
  );
}
