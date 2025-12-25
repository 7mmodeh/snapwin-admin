// app/(admin)/notifications/campaigns/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

type CampaignMode =
  | "all_users"
  | "raffle_users"
  | "selected_customers"
  | "attempt_status"
  | "multi_raffle_union"
  | string;

type CampaignRow = {
  id: string;
  created_at: string;
  created_by: string | null;
  mode: CampaignMode;
  title: string;
  body: string;
  recipient_count: number;
  criteria: JsonValue | null;
};

type DeliveryRow = {
  created_at: string;
  customer_id: string;
  expo_push_token: string | null;
  in_app_inserted: boolean;
  push_attempted: boolean;
  push_ok: boolean;
  error: string | null;
};

function parseDateSafe(isoish: string): Date {
  if (isoish.includes("T")) return new Date(isoish);
  const normalized = isoish.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return new Date(isoish);
  return d;
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NotificationCampaignsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");

  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesErr, setDeliveriesErr] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("admin_notification_campaigns")
        .select(
          "id,created_at,created_by,mode,title,body,recipient_count,criteria"
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const list = (Array.isArray(data) ? data : []) as CampaignRow[];
      setCampaigns(list);

      if (!selectedCampaignId && list[0]?.id) {
        setSelectedCampaignId(list[0].id);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load campaigns.");
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchDeliveries = useCallback(async (campaignId: string) => {
    try {
      setDeliveriesLoading(true);
      setDeliveriesErr(null);

      const { data, error } = await supabase
        .from("admin_notification_deliveries")
        .select(
          "created_at,customer_id,expo_push_token,in_app_inserted,push_attempted,push_ok,error"
        )
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      setDeliveries((Array.isArray(data) ? data : []) as DeliveryRow[]);
    } catch (e: unknown) {
      setDeliveriesErr(
        e instanceof Error ? e.message : "Failed to load deliveries."
      );
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    if (selectedCampaignId) fetchDeliveries(selectedCampaignId);
  }, [selectedCampaignId, fetchDeliveries]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId]
  );

  const deliveryStats = useMemo(() => {
    const total = deliveries.length;
    const inApp = deliveries.filter((d) => d.in_app_inserted).length;
    const attempted = deliveries.filter((d) => d.push_attempted).length;
    const ok = deliveries.filter((d) => d.push_ok).length;
    const failed = deliveries.filter((d) => d.error).length;
    return { total, inApp, attempted, ok, failed };
  }, [deliveries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Notification Campaigns
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Audit trail of all broadcast sends, with per-recipient delivery logs
            and export.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchCampaigns}
          className="px-4 py-2 rounded-full text-sm font-medium border"
          style={{
            borderColor: COLORS.cardBorder,
            color: COLORS.textSecondary,
            backgroundColor: COLORS.cardBg,
          }}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {err ? (
        <div
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: "#FEF2F2",
            borderColor: "#FCA5A5",
            color: COLORS.error,
          }}
        >
          {err}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
          }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: COLORS.cardBorder }}
          >
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Recent campaigns
            </div>
          </div>

          <div className="divide-y" style={{ borderColor: COLORS.cardBorder }}>
            {loading ? (
              <div
                className="px-4 py-4 text-sm"
                style={{ color: COLORS.textMuted }}
              >
                Loading…
              </div>
            ) : campaigns.length === 0 ? (
              <div
                className="px-4 py-4 text-sm"
                style={{ color: COLORS.textMuted }}
              >
                No campaigns yet.
              </div>
            ) : (
              campaigns.map((c) => {
                const active = c.id === selectedCampaignId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCampaignId(c.id)}
                    className="w-full text-left px-4 py-3"
                    style={{
                      backgroundColor: active
                        ? COLORS.highlightCardBg
                        : COLORS.cardBg,
                    }}
                  >
                    <div
                      className="text-sm font-medium"
                      style={{ color: COLORS.textPrimary }}
                    >
                      {c.title}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: COLORS.textMuted }}
                    >
                      {parseDateSafe(c.created_at).toLocaleString("en-IE")} •{" "}
                      {c.mode} • recipients: {c.recipient_count}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          <div
            className="rounded-2xl p-4 border"
            style={{
              backgroundColor: COLORS.cardBg,
              borderColor: COLORS.cardBorder,
              boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div
                  className="text-sm font-semibold"
                  style={{ color: COLORS.textPrimary }}
                >
                  Campaign details
                </div>
                {selectedCampaign ? (
                  <>
                    <div
                      className="text-xs"
                      style={{ color: COLORS.textMuted }}
                    >
                      ID: {selectedCampaign.id}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: COLORS.textMuted }}
                    >
                      {parseDateSafe(
                        selectedCampaign.created_at
                      ).toLocaleString("en-IE")}{" "}
                      • Mode: {selectedCampaign.mode} • Recipients:{" "}
                      {selectedCampaign.recipient_count}
                    </div>
                  </>
                ) : (
                  <div className="text-xs" style={{ color: COLORS.textMuted }}>
                    Select a campaign to view details.
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={!selectedCampaign || deliveries.length === 0}
                onClick={() => {
                  if (!selectedCampaign) return;
                  const rows: Record<string, unknown>[] = deliveries.map(
                    (d) => ({
                      campaign_id: selectedCampaign.id,
                      ...d,
                    })
                  );
                  downloadCsv(
                    `campaign_${selectedCampaign.id}_deliveries.csv`,
                    rows
                  );
                }}
                className="px-4 py-2 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: COLORS.primaryButtonBg,
                  color: COLORS.primaryButtonText,
                  opacity:
                    !selectedCampaign || deliveries.length === 0 ? 0.6 : 1,
                }}
              >
                Export deliveries CSV
              </button>
            </div>

            {selectedCampaign ? (
              <div
                className="mt-3 text-sm"
                style={{ color: COLORS.textSecondary }}
              >
                <div
                  className="font-medium"
                  style={{ color: COLORS.textPrimary }}
                >
                  {selectedCampaign.title}
                </div>
                <div className="mt-1">{selectedCampaign.body}</div>
                <div
                  className="mt-2 text-xs break-words"
                  style={{ color: COLORS.textMuted }}
                >
                  Criteria:{" "}
                  {selectedCampaign.criteria == null
                    ? "—"
                    : JSON.stringify(selectedCampaign.criteria)}
                </div>
              </div>
            ) : null}
          </div>

          <div
            className="rounded-2xl p-4 border"
            style={{
              backgroundColor: COLORS.cardBg,
              borderColor: COLORS.cardBorder,
              boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: COLORS.textPrimary }}
                >
                  Delivery logs
                </div>
                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Total: {deliveryStats.total} • In-app: {deliveryStats.inApp} •
                  Push attempted: {deliveryStats.attempted} • Push ok:{" "}
                  {deliveryStats.ok} • Errors: {deliveryStats.failed}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  selectedCampaignId && fetchDeliveries(selectedCampaignId)
                }
                className="px-4 py-2 rounded-full text-sm font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  color: COLORS.textSecondary,
                  backgroundColor: COLORS.cardBg,
                }}
                disabled={deliveriesLoading || !selectedCampaignId}
              >
                {deliveriesLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {deliveriesErr ? (
              <div
                className="mt-3 rounded-2xl px-4 py-3 text-sm border"
                style={{
                  backgroundColor: "#FEF2F2",
                  borderColor: "#FCA5A5",
                  color: COLORS.error,
                }}
              >
                {deliveriesErr}
              </div>
            ) : null}

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{
                      backgroundColor: COLORS.highlightCardBg,
                      color: COLORS.textSecondary,
                    }}
                  >
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">In-app</th>
                    <th className="px-3 py-2 font-medium">Push</th>
                    <th className="px-3 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveriesLoading ? (
                    <tr>
                      <td
                        className="px-3 py-3"
                        colSpan={5}
                        style={{ color: COLORS.textMuted }}
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : deliveries.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3"
                        colSpan={5}
                        style={{ color: COLORS.textMuted }}
                      >
                        No deliveries.
                      </td>
                    </tr>
                  ) : (
                    deliveries.slice(0, 200).map((d) => (
                      <tr
                        key={`${d.customer_id}-${d.created_at}`}
                        className="border-t"
                        style={{ borderColor: COLORS.cardBorder }}
                      >
                        <td
                          className="px-3 py-2 whitespace-nowrap"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {parseDateSafe(d.created_at).toLocaleString("en-IE")}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-xs"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {d.customer_id}
                        </td>
                        <td
                          className="px-3 py-2"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {d.in_app_inserted ? "Yes" : "No"}
                        </td>
                        <td
                          className="px-3 py-2"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {d.push_attempted
                            ? d.push_ok
                              ? "OK"
                              : "Failed"
                            : "—"}
                        </td>
                        <td
                          className="px-3 py-2 break-words"
                          style={{
                            color: d.error ? COLORS.error : COLORS.textMuted,
                          }}
                        >
                          {d.error ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {deliveries.length > 200 ? (
                <div
                  className="mt-2 text-xs"
                  style={{ color: COLORS.textMuted }}
                >
                  Showing first 200 rows in UI. Export CSV to get all rows.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
