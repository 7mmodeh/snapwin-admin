"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function summarizeCriteria(
  mode: string,
  criteria: Record<string, unknown>
): string {
  const mk = toModeKey(mode);

  // Your campaigns table has a generic "criteria" jsonb.
  // We’ll read common keys, but stay tolerant to missing/unknown shapes.
  const raffleId = safeString(criteria["raffle_id"]);
  const raffleIds = criteria["raffle_ids"];
  const customerIds = criteria["customer_ids"];
  const attemptPassed = criteria["attempt_passed"];
  const onlyCompleted = criteria["only_completed_tickets"];

  const onlyCompletedText =
    typeof onlyCompleted === "boolean"
      ? onlyCompleted
        ? "Completed tickets only"
        : "All tickets"
      : "Completed tickets only";

  if (mk === "all_users") return "Everyone";

  if (mk === "raffle_users") {
    return raffleId
      ? `Raffle: ${formatShortId(raffleId)} • ${onlyCompletedText}`
      : `Raffle: — • ${onlyCompletedText}`;
  }

  if (mk === "multi_raffle_union") {
    const count = Array.isArray(raffleIds)
      ? raffleIds.length
      : typeof raffleIds === "string"
      ? raffleIds.split(",").filter(Boolean).length
      : 0;
    return `Raffles: ${count || "—"} • ${onlyCompletedText}`;
  }

  if (mk === "selected_customers") {
    const count = Array.isArray(customerIds)
      ? customerIds.length
      : typeof customerIds === "string"
      ? customerIds.split(",").filter(Boolean).length
      : 0;
    return `Customers: ${count || "—"}`;
  }

  if (mk === "attempt_status") {
    const passedText =
      typeof attemptPassed === "boolean"
        ? attemptPassed
          ? "Passed"
          : "Failed"
        : "Passed/Failed";
    return raffleId
      ? `${passedText} • Raffle: ${formatShortId(raffleId)}`
      : `${passedText} • All raffles`;
  }

  return "—";
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

export default function CampaignsPage() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [aggs, setAggs] = useState<Record<string, DeliveryAgg>>({});

  // Filters
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<ModeKey | "all">("all");
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all">("7d");

  const [selected, setSelected] = useState<CampaignRow | null>(null);

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

  const fetchAggs = useCallback(async (campaignIds: string[]) => {
    if (campaignIds.length === 0) {
      setAggs({});
      return;
    }

    // We aggregate deliveries client-side (simple + reliable).
    const { data, error } = await supabase
      .from("admin_notification_deliveries")
      .select("campaign_id,push_attempted,push_ok")
      .in("campaign_id", campaignIds);

    if (error) throw error;

    const rows = Array.isArray(data) ? (data as unknown[]) : [];
    const next: Record<string, DeliveryAgg> = {};

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
  }, []);

  const load = useCallback(async () => {
    setErrorMsg(null);
    setLoading(true);

    try {
      let q = supabase
        .from("admin_notification_campaigns")
        .select(
          "id,created_at,created_by,mode,title,body,data,criteria,recipient_count"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (timeMinIso) q = q.gte("created_at", timeMinIso);

      if (modeFilter !== "all") q = q.eq("mode", modeFilter);

      const s = search.trim();
      if (s) {
        // Simple search over title/body (case-insensitive) via ilike
        q = q.or(`title.ilike.%${s}%,body.ilike.%${s}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];
      const normalized: CampaignRow[] = list.map((row) => {
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
      });

      setCampaigns(normalized);
      await fetchAggs(normalized.map((c) => c.id));

      // keep selected in sync if list changes
      setSelected((prev) =>
        prev ? normalized.find((x) => x.id === prev.id) ?? null : null
      );
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [fetchAggs, modeFilter, search, timeMinIso]);

  useEffect(() => {
    load();
  }, [load]);

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
            Audit log of notification campaigns and their delivery status.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
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
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Click a row to view details
            </div>
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
                const isActive = selected?.id === c.id;

                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="w-full text-left px-4 py-4 transition"
                    style={{
                      backgroundColor: isActive
                        ? COLORS.highlightCardBg
                        : COLORS.cardBg,
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
                          {summarizeCriteria(c.mode, c.criteria)}
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
        </div>

        {/* Details */}
        <div
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
          }}
        >
          <div
            className="text-sm font-semibold mb-3"
            style={{ color: COLORS.textPrimary }}
          >
            Details
          </div>

          {!selected ? (
            <div className="text-sm" style={{ color: COLORS.textMuted }}>
              Select a campaign to view details.
            </div>
          ) : (
            (() => {
              const a = aggs[selected.id];
              const total = a?.total ?? selected.recipient_count ?? 0;
              const pending = a?.pending ?? 0;
              const ok = a?.ok ?? 0;
              const failed = a?.failed ?? 0;

              return (
                <div className="space-y-4">
                  <div>
                    <div
                      className="text-lg font-bold"
                      style={{ color: COLORS.textPrimary }}
                    >
                      {selected.title || "Untitled"}
                    </div>
                    <div
                      className="text-xs mt-1"
                      style={{ color: COLORS.textMuted }}
                    >
                      {modeLabel(selected.mode)} •{" "}
                      {formatDate(selected.created_at)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: COLORS.textMuted }}
                    >
                      Message
                    </div>
                    <div
                      className="rounded-xl border p-3 text-sm"
                      style={{
                        borderColor: COLORS.cardBorder,
                        backgroundColor: COLORS.screenBg,
                        color: COLORS.textPrimary,
                      }}
                    >
                      {selected.body || "—"}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Chip label="Recipients" value={total} tone="neutral" />
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

                  <div className="space-y-2">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: COLORS.textMuted }}
                    >
                      Criteria summary
                    </div>
                    <div
                      className="text-sm"
                      style={{ color: COLORS.textPrimary }}
                    >
                      {summarizeCriteria(selected.mode, selected.criteria)}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: COLORS.textMuted }}
                    >
                      Raw criteria (JSON)
                    </div>
                    <pre
                      className="text-xs rounded-xl border p-3 overflow-auto"
                      style={{
                        borderColor: COLORS.cardBorder,
                        backgroundColor: COLORS.screenBg,
                        color: COLORS.textSecondary,
                        maxHeight: 240,
                      }}
                    >
                      {JSON.stringify(selected.criteria ?? {}, null, 2)}
                    </pre>
                  </div>

                  <div className="space-y-2">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: COLORS.textMuted }}
                    >
                      Data payload (JSON)
                    </div>
                    <pre
                      className="text-xs rounded-xl border p-3 overflow-auto"
                      style={{
                        borderColor: COLORS.cardBorder,
                        backgroundColor: COLORS.screenBg,
                        color: COLORS.textSecondary,
                        maxHeight: 240,
                      }}
                    >
                      {JSON.stringify(selected.data ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
