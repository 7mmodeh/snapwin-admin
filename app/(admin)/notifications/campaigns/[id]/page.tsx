"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

type ModeKey =
  | "all_users"
  | "raffle_users"
  | "selected_customers"
  | "attempt_status"
  | "multi_raffle_union"
  | "unknown";

type StatusFilter = "all" | "pending" | "ok" | "failed";

// type RaffleMini = { id: string; item_name: string };

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

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

function formatShortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

function formatDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IE");
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

function csvEscape(v: string) {
  const mustQuote =
    v.includes(",") || v.includes("\n") || v.includes('"') || v.includes("\r");
  const s = v.replace(/"/g, '""');
  return mustQuote ? `"${s}"` : s;
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
  max = 600
) {
  const s = JSON.stringify(obj ?? {}, null, 2);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const campaignId = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const [campaign, setCampaign] = useState<CampaignRow | null>(null);

  // raffle name resolver
  const [raffleNameById, setRaffleNameById] = useState<Record<string, string>>(
    {}
  );

  // deliveries
  const PAGE_SIZE = 50;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  }, []);

  const loadCampaign = useCallback(async () => {
    setErrorMsg(null);
    setLoading(true);

    try {
      if (!campaignId) throw new Error("Missing campaign id in route.");

      const { data, error } = await supabase
        .from("admin_notification_campaigns")
        .select(
          "id,created_at,created_by,mode,title,body,data,criteria,recipient_count"
        )
        .eq("id", campaignId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Campaign not found.");

      const obj = data as Record<string, unknown>;
      const normalized: CampaignRow = {
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

      setCampaign(normalized);

      // Resolve raffle names if criteria contains raffle_id/raffle_ids
      const rid = safeString(normalized.criteria?.["raffle_id"]);
      const rids = parseUuidArray(normalized.criteria?.["raffle_ids"]);
      const toResolve = Array.from(new Set([rid, ...rids].filter(Boolean)));

      if (toResolve.length > 0) {
        const { data: raffles, error: raffleErr } = await supabase
          .from("raffles")
          .select("id,item_name")
          .in("id", toResolve)
          .limit(200);

        if (raffleErr) throw raffleErr;

        const list = Array.isArray(raffles) ? (raffles as unknown[]) : [];
        const map: Record<string, string> = {};
        for (const r of list) {
          const ro = (r ?? {}) as Record<string, unknown>;
          const id = safeString(ro["id"]);
          const item_name = safeString(ro["item_name"]);
          if (id && item_name) map[id] = item_name;
        }
        setRaffleNameById(map);
      } else {
        setRaffleNameById({});
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load campaign.");
      setCampaign(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

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
          .slice(0, 4) as string[];
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

  const loadDeliveries = useCallback(
    async (opts: { reset: boolean }) => {
      if (!campaignId) return;

      setDeliveriesError(null);
      setDeliveriesLoading(true);

      try {
        const nextPage = opts.reset ? 0 : page;
        const from = nextPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let q = supabase
          .from("admin_notification_deliveries")
          .select(
            "id,created_at,campaign_id,customer_id,expo_push_token,in_app_inserted,push_attempted,push_ok,push_provider,push_response,error"
          )
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: false })
          .range(from, to);

        // status filter
        if (status === "pending") {
          q = q.eq("push_attempted", false);
        } else if (status === "ok") {
          q = q.eq("push_attempted", true).eq("push_ok", true);
        } else if (status === "failed") {
          q = q.eq("push_attempted", true).eq("push_ok", false);
        }

        const { data, error } = await q;
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

        if (opts.reset) {
          setDeliveries(normalized);
          setPage(1);
        } else {
          setDeliveries((prev) => [...prev, ...normalized]);
          setPage((p) => p + 1);
        }

        setHasMore(normalized.length === PAGE_SIZE);
      } catch (e: unknown) {
        setDeliveriesError(
          e instanceof Error ? e.message : "Failed to load deliveries."
        );
      } finally {
        setDeliveriesLoading(false);
      }
    },
    [PAGE_SIZE, campaignId, page, status]
  );

  // initial load
  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  // reset deliveries on status change
  useEffect(() => {
    setDeliveries([]);
    setHasMore(true);
    setPage(0);
    void loadDeliveries({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, campaignId]);

  const copyId = useCallback(async () => {
    if (!campaign) return;
    const ok = await copyToClipboard(campaign.id);
    showToast(ok ? "Campaign ID copied" : "Copy failed");
  }, [campaign, showToast]);

  const exportCurrentPageCsv = useCallback(() => {
    if (!campaign) return;

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

    for (const d of deliveries) {
      const row = [
        d.id,
        d.created_at,
        d.campaign_id,
        d.customer_id,
        d.expo_push_token ?? "",
        String(d.in_app_inserted),
        String(d.push_attempted),
        String(d.push_ok),
        d.push_provider ?? "",
        d.error ?? "",
        d.push_response ? JSON.stringify(d.push_response) : "",
      ].map(csvEscape);

      lines.push(row.join(","));
    }

    downloadCsv(
      `snapwin-campaign-${campaign.id}-deliveries-page.csv`,
      lines.join("\n")
    );
    showToast("CSV exported (current page)");
  }, [campaign, deliveries, showToast]);

  const criteriaSummary = useMemo(() => {
    if (!campaign) return "—";
    return summarizeCriteriaHuman(campaign.mode, campaign.criteria ?? {});
  }, [campaign, summarizeCriteriaHuman]);

  const statusLabel = useMemo(() => {
    if (status === "pending") return "Pending";
    if (status === "ok") return "OK";
    if (status === "failed") return "Failed";
    return "All";
  }, [status]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-[60vh]"
        style={{ color: COLORS.textMuted }}
      >
        Loading campaign…
      </div>
    );
  }

  if (errorMsg || !campaign) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.push("/notifications/campaigns")}
          className="text-sm underline"
          style={{ color: COLORS.textMuted }}
        >
          ← Back to campaigns
        </button>

        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#FEF2F2",
            borderColor: "#FCA5A5",
            color: COLORS.error,
          }}
        >
          {errorMsg ?? "Campaign not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
          <button
            type="button"
            onClick={() => router.push("/notifications/campaigns")}
            className="text-sm underline"
            style={{ color: COLORS.textMuted }}
          >
            ← Back to campaigns
          </button>

          <h1
            className="text-2xl font-bold mt-2"
            style={{ color: COLORS.textPrimary }}
          >
            {campaign.title || "Untitled"}
          </h1>

          <div className="text-sm mt-1" style={{ color: COLORS.textMuted }}>
            {modeLabel(campaign.mode)} • {formatDate(campaign.created_at)} • ID:{" "}
            {formatShortId(campaign.id)}
          </div>

          <div className="text-sm mt-2" style={{ color: COLORS.textSecondary }}>
            {criteriaSummary}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyId}
            className="rounded px-4 py-2 text-sm font-semibold border"
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
            onClick={exportCurrentPageCsv}
            className="rounded px-4 py-2 text-sm font-semibold"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
            }}
          >
            Export CSV (page)
          </button>
        </div>
      </div>

      {/* Message preview */}
      <div
        className="rounded-2xl border p-4"
        style={{
          borderColor: COLORS.cardBorder,
          backgroundColor: COLORS.cardBg,
        }}
      >
        <div
          className="text-xs font-semibold"
          style={{ color: COLORS.textMuted }}
        >
          Message preview
        </div>
        <div
          className="text-sm font-semibold mt-1"
          style={{ color: COLORS.textPrimary }}
        >
          {campaign.title || "SnapWin"}
        </div>
        <div className="text-sm mt-1" style={{ color: COLORS.textSecondary }}>
          {campaign.body || "—"}
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className="rounded-xl border p-3 text-xs overflow-auto"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.screenBg,
              color: COLORS.textSecondary,
              maxHeight: 180,
            }}
          >
            <div
              className="font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              criteria (JSON)
            </div>
            {jsonPreview(campaign.criteria, 900)}
          </div>

          <div
            className="rounded-xl border p-3 text-xs overflow-auto"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.screenBg,
              color: COLORS.textSecondary,
              maxHeight: 180,
            }}
          >
            <div
              className="font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              data payload (JSON)
            </div>
            {jsonPreview(campaign.data, 900)}
          </div>
        </div>
      </div>

      {/* Deliveries */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{
          borderColor: COLORS.cardBorder,
          backgroundColor: COLORS.cardBg,
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-3"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Deliveries
            </div>
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Filter: {statusLabel} • Showing {deliveries.length} rows
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="ok">OK</option>
              <option value="failed">Failed</option>
            </select>

            <button
              type="button"
              onClick={() => loadDeliveries({ reset: true })}
              className="rounded px-3 py-2 text-sm font-semibold border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.screenBg,
                color: COLORS.textSecondary,
                opacity: deliveriesLoading ? 0.7 : 1,
              }}
              disabled={deliveriesLoading}
            >
              {deliveriesLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {deliveriesError ? (
          <div
            className="px-4 py-3 text-sm border-t"
            style={{
              backgroundColor: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: COLORS.error,
            }}
          >
            {deliveriesError}
          </div>
        ) : null}

        {deliveriesLoading && deliveries.length === 0 ? (
          <div
            className="px-4 py-6 text-sm"
            style={{ color: COLORS.textMuted }}
          >
            Loading deliveries…
          </div>
        ) : deliveries.length === 0 ? (
          <div
            className="px-4 py-6 text-sm"
            style={{ color: COLORS.textMuted }}
          >
            No deliveries found for this filter.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: COLORS.screenBg }}>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Time
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Customer
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Push
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    In-app
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Token
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Error / Response
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const pushState = !d.push_attempted
                    ? "PENDING"
                    : d.push_ok
                    ? "OK"
                    : "FAILED";

                  return (
                    <tr
                      key={d.id}
                      className="border-t"
                      style={{ borderColor: COLORS.cardBorder }}
                    >
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textSecondary }}
                      >
                        {formatDate(d.created_at)}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {formatShortId(d.customer_id)}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {pushState}
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          {d.push_provider ?? "expo"}
                        </div>
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {d.in_app_inserted ? "Yes" : "No"}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textSecondary }}
                      >
                        {d.expo_push_token ? "Yes" : "No"}
                      </td>
                      <td
                        className="px-4 py-2"
                        style={{ color: COLORS.textSecondary }}
                      >
                        {d.error ? (
                          <div style={{ color: COLORS.error }}>{d.error}</div>
                        ) : d.push_response ? (
                          <div className="text-xs">
                            {jsonPreview(d.push_response, 220)}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="px-4 py-4 border-t flex items-center justify-between gap-3"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div className="text-xs" style={{ color: COLORS.textMuted }}>
            Campaign recipients (stored): {campaign.recipient_count}
          </div>

          <button
            type="button"
            onClick={() => loadDeliveries({ reset: false })}
            disabled={deliveriesLoading || !hasMore}
            className="rounded px-4 py-2 text-sm font-semibold"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: deliveriesLoading || !hasMore ? 0.55 : 1,
            }}
          >
            {hasMore
              ? deliveriesLoading
                ? "Loading…"
                : "Load more"
              : "No more results"}
          </button>
        </div>
      </div>
    </div>
  );
}
