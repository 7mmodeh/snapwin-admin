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

type DeliveryRow = {
  id: string;
  created_at: string;
  campaign_id: string;
  customer_id: string;
  expo_push_token: string | null;
  in_app_inserted: boolean;
  push_attempted: boolean;
  push_ok: boolean;
  push_provider: string | null;
  push_response: Record<string, unknown> | null;
  error: string | null;
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

function summarizeCriteria(
  mode: string,
  criteria: Record<string, unknown>
): string {
  const mk = toModeKey(mode);

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
    if (tone === "good")
      return { bg: "#ECFDF5", border: "#6EE7B7", text: "#065F46" };
    if (tone === "warn")
      return { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" };
    if (tone === "bad")
      return { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B" };
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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function jsonPreview(
  obj: Record<string, unknown> | null | undefined,
  max = 220
) {
  const s = JSON.stringify(obj ?? {}, null, 0);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string) {
  const mustQuote =
    v.includes(",") || v.includes("\n") || v.includes('"') || v.includes("\r");
  const s = v.replace(/"/g, '""');
  return mustQuote ? `"${s}"` : s;
}

export default function CampaignsPage() {
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

  const [selected, setSelected] = useState<CampaignRow | null>(null);

  // Details: failures list
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [failuresError, setFailuresError] = useState<string | null>(null);
  const [failures, setFailures] = useState<DeliveryRow[]>([]);
  const [showFailures, setShowFailures] = useState(true);

  // UI toasts (lightweight)
  const [toast, setToast] = useState<string | null>(null);

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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
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
      const next = { ...aggs };

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

        if (opts.reset) {
          setCampaigns(normalized);
          setPage(1);
        } else {
          setCampaigns((prev) => {
            const merged = [...prev, ...normalized];
            // de-dupe by id (in case filters change quickly)
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

        // keep selected in sync
        setSelected((prev) => {
          if (!prev) return null;
          const inNew = normalized.find((x) => x.id === prev.id);
          return inNew ?? prev;
        });
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
    ]
  );

  // Reset pagination when filters change
  useEffect(() => {
    setSelected(null);
    setFailures([]);
    setFailuresError(null);
    setHasMore(true);
    setPage(0);
    void loadPage({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, modeFilter, range]);

  const refresh = useCallback(async () => {
    setSelected(null);
    setFailures([]);
    setFailuresError(null);
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

  const selectedAgg = useMemo(() => {
    if (!selected) return null;
    const a = aggs[selected.id];
    return {
      total: a?.total ?? selected.recipient_count ?? 0,
      pending: a?.pending ?? 0,
      ok: a?.ok ?? 0,
      failed: a?.failed ?? 0,
    };
  }, [aggs, selected]);

  const loadFailures = useCallback(async (campaignId: string) => {
    setFailures([]);
    setFailuresError(null);
    setFailuresLoading(true);

    try {
      const { data, error } = await supabase
        .from("admin_notification_deliveries")
        .select(
          "id,created_at,campaign_id,customer_id,expo_push_token,in_app_inserted,push_attempted,push_ok,push_provider,push_response,error"
        )
        .eq("campaign_id", campaignId)
        .eq("push_attempted", true)
        .eq("push_ok", false)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];
      const normalized: DeliveryRow[] = list.map((r) => {
        const obj = (r ?? {}) as Record<string, unknown>;
        return {
          id: safeString(obj["id"]),
          created_at: safeString(obj["created_at"]),
          campaign_id: safeString(obj["campaign_id"]),
          customer_id: safeString(obj["customer_id"]),
          expo_push_token: obj["expo_push_token"]
            ? safeString(obj["expo_push_token"])
            : null,
          in_app_inserted: Boolean(obj["in_app_inserted"]),
          push_attempted: Boolean(obj["push_attempted"]),
          push_ok: Boolean(obj["push_ok"]),
          push_provider: obj["push_provider"]
            ? safeString(obj["push_provider"])
            : null,
          push_response: isObject(obj["push_response"])
            ? (obj["push_response"] as Record<string, unknown>)
            : null,
          error: obj["error"] ? safeString(obj["error"]) : null,
        };
      });

      setFailures(normalized);
    } catch (e: unknown) {
      setFailuresError(
        e instanceof Error ? e.message : "Failed to load failures."
      );
    } finally {
      setFailuresLoading(false);
    }
  }, []);

  // When selecting a campaign, load failures if needed
  useEffect(() => {
    if (!selected) return;
    const a = aggs[selected.id];
    const failed = a?.failed ?? 0;
    if (failed > 0 && showFailures) {
      void loadFailures(selected.id);
    } else {
      setFailures([]);
      setFailuresError(null);
    }
  }, [aggs, loadFailures, selected, showFailures]);

  const handleCopyCampaignId = useCallback(async () => {
    if (!selected) return;
    const ok = await copyToClipboard(selected.id);
    showToast(ok ? "Campaign ID copied" : "Copy failed");
  }, [selected, showToast]);

  const handleCopyCriteria = useCallback(async () => {
    if (!selected) return;
    const ok = await copyToClipboard(
      JSON.stringify(selected.criteria ?? {}, null, 2)
    );
    showToast(ok ? "Criteria copied" : "Copy failed");
  }, [selected, showToast]);

  const handleCopyData = useCallback(async () => {
    if (!selected) return;
    const ok = await copyToClipboard(
      JSON.stringify(selected.data ?? {}, null, 2)
    );
    showToast(ok ? "Data copied" : "Copy failed");
  }, [selected, showToast]);

  const exportDeliveriesCsv = useCallback(async () => {
    if (!selected) return;

    try {
      setFailuresError(null);
      setFailuresLoading(true);

      // Fetch all deliveries for this campaign (cap at 5000 to protect browser)
      const { data, error } = await supabase
        .from("admin_notification_deliveries")
        .select(
          "id,created_at,campaign_id,customer_id,expo_push_token,in_app_inserted,push_attempted,push_ok,push_provider,error,push_response"
        )
        .eq("campaign_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];

      const header = [
        "id",
        "created_at",
        "campaign_id",
        "customer_id",
        "expo_push_token",
        "in_app_inserted",
        "push_attempted",
        "push_ok",
        "push_provider",
        "error",
        "push_response_json",
      ];

      const lines: string[] = [];
      lines.push(header.join(","));

      for (const r of list) {
        const obj = (r ?? {}) as Record<string, unknown>;
        const pushResp = isObject(obj["push_response"])
          ? JSON.stringify(obj["push_response"])
          : safeString(obj["push_response"]);
        const row = [
          safeString(obj["id"]),
          safeString(obj["created_at"]),
          safeString(obj["campaign_id"]),
          safeString(obj["customer_id"]),
          obj["expo_push_token"] ? safeString(obj["expo_push_token"]) : "",
          String(Boolean(obj["in_app_inserted"])),
          String(Boolean(obj["push_attempted"])),
          String(Boolean(obj["push_ok"])),
          obj["push_provider"] ? safeString(obj["push_provider"]) : "",
          obj["error"] ? safeString(obj["error"]) : "",
          pushResp || "",
        ].map(csvEscape);

        lines.push(row.join(","));
      }

      const csv = lines.join("\n");
      downloadCsv(`snapwin-campaign-${selected.id}-deliveries.csv`, csv);
      showToast("CSV exported");
    } catch (e: unknown) {
      setFailuresError(
        e instanceof Error ? e.message : "Failed to export CSV."
      );
    } finally {
      setFailuresLoading(false);
    }
  }, [selected, showToast]);

  return (
    <div className="space-y-6">
      {toast ? (
        <div
          className="fixed top-4 right-4 z-50 rounded-xl border px-4 py-2 text-sm shadow"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            color: COLORS.textPrimary,
          }}
        >
          {toast}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: COLORS.textPrimary }}
          >
            Campaigns
          </h1>
          <p className="text-sm mt-1" style={{ color: COLORS.textMuted }}>
            Human-friendly audit log of notification campaigns and delivery
            status.
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

            <div className="flex items-center gap-2">
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

        {/* Details */}
        <div
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Details
            </div>

            {selected ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCampaignId}
                  className="rounded px-3 py-1.5 text-xs font-semibold border"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.screenBg,
                    color: COLORS.textSecondary,
                  }}
                >
                  Copy ID
                </button>

                <button
                  type="button"
                  onClick={exportDeliveriesCsv}
                  className="rounded px-3 py-1.5 text-xs font-semibold border"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.screenBg,
                    color: COLORS.textSecondary,
                    opacity: failuresLoading ? 0.7 : 1,
                  }}
                  disabled={failuresLoading}
                >
                  Export CSV
                </button>
              </div>
            ) : null}
          </div>

          {!selected ? (
            <div className="text-sm" style={{ color: COLORS.textMuted }}>
              Select a campaign to view details.
            </div>
          ) : (
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
                  {modeLabel(selected.mode)} • {formatDate(selected.created_at)}
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

              {selectedAgg ? (
                <div className="flex flex-wrap gap-2">
                  <Chip
                    label="Recipients"
                    value={selectedAgg.total}
                    tone="neutral"
                  />
                  <Chip
                    label="Pending"
                    value={selectedAgg.pending}
                    tone={selectedAgg.pending > 0 ? "warn" : "neutral"}
                  />
                  <Chip
                    label="OK"
                    value={selectedAgg.ok}
                    tone={selectedAgg.ok > 0 ? "good" : "neutral"}
                  />
                  <Chip
                    label="Failed"
                    value={selectedAgg.failed}
                    tone={selectedAgg.failed > 0 ? "bad" : "neutral"}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-xs font-semibold"
                    style={{ color: COLORS.textMuted }}
                  >
                    Criteria
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCriteria}
                    className="text-xs underline"
                    style={{ color: COLORS.textMuted }}
                  >
                    Copy JSON
                  </button>
                </div>

                <div className="text-sm" style={{ color: COLORS.textPrimary }}>
                  {summarizeCriteria(selected.mode, selected.criteria)}
                </div>

                <div
                  className="rounded-xl border p-3 text-xs overflow-auto"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.screenBg,
                    color: COLORS.textSecondary,
                    maxHeight: 160,
                  }}
                  title={JSON.stringify(selected.criteria ?? {}, null, 2)}
                >
                  {jsonPreview(selected.criteria, 600)}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-xs font-semibold"
                    style={{ color: COLORS.textMuted }}
                  >
                    Data payload
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyData}
                    className="text-xs underline"
                    style={{ color: COLORS.textMuted }}
                  >
                    Copy JSON
                  </button>
                </div>

                <div
                  className="rounded-xl border p-3 text-xs overflow-auto"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.screenBg,
                    color: COLORS.textSecondary,
                    maxHeight: 160,
                  }}
                  title={JSON.stringify(selected.data ?? {}, null, 2)}
                >
                  {jsonPreview(selected.data, 600)}
                </div>
              </div>

              {/* Failures */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-xs font-semibold"
                    style={{ color: COLORS.textMuted }}
                  >
                    Delivery failures
                  </div>

                  <label
                    className="flex items-center gap-2 text-xs"
                    style={{ color: COLORS.textMuted }}
                  >
                    <input
                      type="checkbox"
                      checked={showFailures}
                      onChange={(e) => setShowFailures(e.target.checked)}
                    />
                    Show failures
                  </label>
                </div>

                {!showFailures ? (
                  <div className="text-sm" style={{ color: COLORS.textMuted }}>
                    Failures hidden.
                  </div>
                ) : failuresLoading ? (
                  <div className="text-sm" style={{ color: COLORS.textMuted }}>
                    Loading failures…
                  </div>
                ) : failuresError ? (
                  <div
                    className="rounded px-3 py-2 text-sm border"
                    style={{
                      backgroundColor: "#FEF2F2",
                      borderColor: "#FCA5A5",
                      color: COLORS.error,
                    }}
                  >
                    {failuresError}
                  </div>
                ) : failures.length === 0 ? (
                  <div className="text-sm" style={{ color: COLORS.textMuted }}>
                    No failures found (or failures not loaded yet).
                  </div>
                ) : (
                  <div
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    <div
                      className="px-3 py-2 text-xs border-b"
                      style={{
                        borderColor: COLORS.cardBorder,
                        color: COLORS.textMuted,
                        backgroundColor: COLORS.screenBg,
                      }}
                    >
                      Showing latest {failures.length} failed deliveries (max
                      50)
                    </div>

                    <div
                      className="divide-y"
                      style={{ borderColor: COLORS.cardBorder }}
                    >
                      {failures.map((f) => (
                        <div key={f.id} className="px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className="text-xs"
                              style={{ color: COLORS.textMuted }}
                            >
                              {formatDate(f.created_at)} • Customer:{" "}
                              {formatShortId(f.customer_id)}
                            </div>
                            <div
                              className="text-xs"
                              style={{ color: COLORS.textMuted }}
                            >
                              {f.push_provider ?? "expo"}
                            </div>
                          </div>

                          <div
                            className="mt-1 text-sm"
                            style={{ color: COLORS.textPrimary }}
                          >
                            {f.error
                              ? f.error
                              : "Push failed (no error message stored)"}
                          </div>

                          {f.push_response ? (
                            <div
                              className="mt-2 rounded-lg border p-2 text-xs overflow-auto"
                              style={{
                                borderColor: COLORS.cardBorder,
                                backgroundColor: COLORS.screenBg,
                                color: COLORS.textSecondary,
                                maxHeight: 120,
                              }}
                            >
                              {jsonPreview(f.push_response, 500)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick reload failures */}
              {selectedAgg && selectedAgg.failed > 0 && showFailures ? (
                <button
                  type="button"
                  onClick={() => void loadFailures(selected.id)}
                  className="rounded px-4 py-2 text-sm font-semibold border"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.screenBg,
                    color: COLORS.textSecondary,
                    opacity: failuresLoading ? 0.7 : 1,
                  }}
                  disabled={failuresLoading}
                >
                  {failuresLoading
                    ? "Refreshing failures…"
                    : "Refresh failures"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
