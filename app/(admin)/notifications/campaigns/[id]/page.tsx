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

type CustomerMini = {
  id: string;
  name: string;
  email: string;
};

type ModeKey =
  | "all_users"
  | "raffle_users"
  | "selected_customers"
  | "attempt_status"
  | "multi_raffle_union"
  | "unknown";

type StatusFilter = "all" | "pending" | "ok" | "failed";

type CustomerMap = Record<string, CustomerMini>;

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

function clampText(s: string, max = 160) {
  const x = (s ?? "").trim();
  if (!x) return "—";
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function inferPushAttempted(d: DeliveryRow): boolean {
  if (d.push_attempted) return true;
  if (d.error) return true;
  if (d.push_response && Object.keys(d.push_response).length > 0) return true;
  return false;
}

function inferPushOk(d: DeliveryRow): boolean | null {
  if (d.push_attempted) return d.push_ok;

  if (d.error) return false;

  if (d.push_response) {
    const pr = d.push_response;
    const status = safeString(pr["status"]).toLowerCase();
    if (status === "ok" || status === "success") return true;
    if (status === "error" || status === "failed") return false;

    const ok = pr["ok"];
    if (typeof ok === "boolean") return ok;

    return null;
  }

  return null;
}

function Pill({
  text,
  tone,
}: {
  text: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const styles = (() => {
    if (tone === "good") return { bg: "#ECFDF5", bd: "#6EE7B7", tx: "#065F46" };
    if (tone === "warn") return { bg: "#FFFBEB", bd: "#FDE68A", tx: "#92400E" };
    if (tone === "bad") return { bg: "#FEF2F2", bd: "#FCA5A5", tx: "#991B1B" };
    if (tone === "info") return { bg: "#EFF6FF", bd: "#BFDBFE", tx: "#1D4ED8" };
    return {
      bg: COLORS.screenBg,
      bd: COLORS.cardBorder,
      tx: COLORS.textSecondary,
    };
  })();

  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold"
      style={{
        backgroundColor: styles.bg,
        borderColor: styles.bd,
        color: styles.tx,
      }}
    >
      {text}
    </span>
  );
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

  // customer resolver (for deliveries)
  const [customerById, setCustomerById] = useState<CustomerMap>({});

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

  const resolveCustomers = useCallback(
    async (ids: string[]) => {
      const uniq = Array.from(new Set(ids.filter(Boolean)));
      const unknown = uniq.filter((id) => !customerById[id]);
      if (unknown.length === 0) return;

      const { data, error } = await supabase
        .from("customers")
        .select("id,name,email")
        .in("id", unknown)
        .limit(500);

      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];
      const next: CustomerMap = { ...customerById };

      for (const r of list) {
        const obj = (r ?? {}) as Record<string, unknown>;
        const id = safeString(obj["id"]);
        if (!id) continue;
        next[id] = {
          id,
          name: safeString(obj["name"]),
          email: safeString(obj["email"]),
        };
      }

      setCustomerById(next);
    },
    [customerById]
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

        // status filter (DB-truth filter)
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

        await resolveCustomers(normalized.map((d) => d.customer_id));
      } catch (e: unknown) {
        setDeliveriesError(
          e instanceof Error ? e.message : "Failed to load deliveries."
        );
      } finally {
        setDeliveriesLoading(false);
      }
    },
    [PAGE_SIZE, campaignId, page, resolveCustomers, status]
  );

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

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
      "customer_name",
      "customer_email",
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
      const cm = customerById[d.customer_id];
      const row = [
        d.id,
        d.created_at,
        d.campaign_id,
        d.customer_id,
        cm?.name ?? "",
        cm?.email ?? "",
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
  }, [campaign, deliveries, customerById, showToast]);

  const criteriaSummary = useMemo(() => {
    if (!campaign) return "—";
    return summarizeCriteriaHuman(campaign.mode, campaign.criteria ?? {});
  }, [campaign, summarizeCriteriaHuman]);

  const statusLabel = useMemo(() => {
    if (status === "pending") return "Pending (DB)";
    if (status === "ok") return "OK (DB)";
    if (status === "failed") return "Failed (DB)";
    return "All";
  }, [status]);

  const telemetryLooksUnwritten = useMemo(() => {
    if (deliveries.length === 0) return false;
    const attempted = deliveries.some((d) => d.push_attempted);
    return !attempted;
  }, [deliveries]);

  const criteriaChips = useMemo(() => {
    if (!campaign) return [];

    const mk = toModeKey(campaign.mode);
    const cr = campaign.criteria ?? {};

    const raffleId = safeString(cr["raffle_id"]);
    const raffleIds = parseUuidArray(cr["raffle_ids"]);
    const customerIds = parseUuidArray(cr["customer_ids"]);
    const attemptPassed = cr["attempt_passed"];
    const onlyCompleted = cr["only_completed_tickets"];

    const chips: Array<{ text: string; tone: "neutral" | "info" }> = [];
    chips.push({ text: `Mode: ${modeLabel(campaign.mode)}`, tone: "info" });

    const ticketsText =
      typeof onlyCompleted === "boolean"
        ? onlyCompleted
          ? "Completed tickets only"
          : "All tickets"
        : "Completed tickets only";

    if (mk === "raffle_users") {
      const label =
        raffleNameById[raffleId] || (raffleId ? formatShortId(raffleId) : "—");
      chips.push({ text: `Raffle: ${label}`, tone: "neutral" });
      chips.push({ text: ticketsText, tone: "neutral" });
    }

    if (mk === "multi_raffle_union") {
      const names = raffleIds
        .map((id) => raffleNameById[id])
        .filter(Boolean) as string[];
      const shown = names.slice(0, 2);
      const remainder = Math.max(raffleIds.length - shown.length, 0);
      const v =
        shown.length > 0
          ? `${shown.join(", ")}${remainder ? ` +${remainder}` : ""}`
          : `${raffleIds.length} raffles`;
      chips.push({ text: `Raffles: ${v}`, tone: "neutral" });
      chips.push({ text: ticketsText, tone: "neutral" });
    }

    if (mk === "selected_customers") {
      chips.push({
        text: `Selected customers: ${customerIds.length || "—"}`,
        tone: "neutral",
      });
    }

    if (mk === "attempt_status") {
      const passedText =
        typeof attemptPassed === "boolean"
          ? attemptPassed
            ? "Passed"
            : "Failed"
          : "Passed/Failed";
      const scope =
        raffleNameById[raffleId] ||
        (raffleId ? formatShortId(raffleId) : "All raffles");
      chips.push({ text: `Attempt: ${passedText}`, tone: "neutral" });
      chips.push({ text: `Scope: ${scope}`, tone: "neutral" });
    }

    if (mk === "all_users") {
      chips.push({ text: "Everyone", tone: "neutral" });
    }

    return chips;
  }, [campaign, raffleNameById]);

  const deliveryStats = useMemo(() => {
    // Use inferred status for human-friendly header stats (does not change DB)
    const total = deliveries.length;
    let inferredPending = 0;
    let inferredOk = 0;
    let inferredFailed = 0;
    let inferredAttemptedUnknown = 0;

    let withToken = 0;
    let inAppYes = 0;

    for (const d of deliveries) {
      if (d.expo_push_token) withToken += 1;
      if (d.in_app_inserted) inAppYes += 1;

      const attempted = inferPushAttempted(d);
      const ok = inferPushOk(d);

      if (!attempted) inferredPending += 1;
      else if (ok === true) inferredOk += 1;
      else if (ok === false) inferredFailed += 1;
      else inferredAttemptedUnknown += 1;
    }

    return {
      total,
      withToken,
      inAppYes,
      inferredPending,
      inferredOk,
      inferredFailed,
      inferredAttemptedUnknown,
    };
  }, [deliveries]);

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

      {/* Header */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push("/notifications/campaigns")}
          className="text-sm underline"
          style={{ color: COLORS.textMuted }}
        >
          ← Back to campaigns
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              className="text-2xl font-bold truncate"
              style={{ color: COLORS.textPrimary }}
            >
              {campaign.title || "Untitled"}
            </h1>

            <div className="text-sm mt-1" style={{ color: COLORS.textMuted }}>
              {modeLabel(campaign.mode)} • {timeAgo(campaign.created_at)} •{" "}
              {formatDate(campaign.created_at)}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill
                text={`Campaign: ${formatShortId(campaign.id)}`}
                tone="neutral"
              />
              <Pill
                text={`Recipients: ${campaign.recipient_count}`}
                tone="info"
              />
              <Pill
                text={`Loaded deliveries: ${deliveries.length}`}
                tone="neutral"
              />
              <Pill text={criteriaSummary} tone="neutral" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {criteriaChips.map((c, idx) => (
                <Pill
                  key={idx}
                  text={c.text}
                  tone={c.tone === "info" ? "info" : "neutral"}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
      </div>

      {/* Telemetry note */}
      {telemetryLooksUnwritten ? (
        <div
          className="rounded-2xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#FFFBEB",
            borderColor: "#FDE68A",
            color: "#92400E",
          }}
        >
          DB telemetry is not being written (push_attempted/push_ok remain
          false). Push can still be working. This page shows an{" "}
          <b>inferred push status</b> where possible (based on response/error).
        </div>
      ) : null}

      {/* Message preview */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{
          borderColor: COLORS.cardBorder,
          backgroundColor: COLORS.cardBg,
        }}
      >
        <div
          className="text-xs font-semibold"
          style={{ color: COLORS.textMuted }}
        >
          Message
        </div>

        <div className="space-y-1">
          <div
            className="text-sm font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            {campaign.title || "SnapWin"}
          </div>
          <div className="text-sm" style={{ color: COLORS.textSecondary }}>
            {campaign.body || "—"}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className="rounded-xl border p-3 text-xs overflow-auto"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.screenBg,
              color: COLORS.textSecondary,
              maxHeight: 220,
            }}
          >
            <div
              className="font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              criteria (JSON)
            </div>
            <pre className="whitespace-pre-wrap">
              {jsonPreview(campaign.criteria, 1400)}
            </pre>
          </div>

          <div
            className="rounded-xl border p-3 text-xs overflow-auto"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.screenBg,
              color: COLORS.textSecondary,
              maxHeight: 220,
            }}
          >
            <div
              className="font-semibold mb-1"
              style={{ color: COLORS.textMuted }}
            >
              data payload (JSON)
            </div>
            <pre className="whitespace-pre-wrap">
              {jsonPreview(campaign.data, 1400)}
            </pre>
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
          className="px-4 py-3 border-b flex items-start justify-between gap-3"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Deliveries
            </div>

            <div className="text-xs mt-1" style={{ color: COLORS.textMuted }}>
              Filter: {statusLabel} • Loaded: {deliveries.length}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill
                text={`Tokens: ${deliveryStats.withToken}/${deliveryStats.total}`}
                tone="neutral"
              />
              <Pill
                text={`In-app: ${deliveryStats.inAppYes}/${deliveryStats.total}`}
                tone="neutral"
              />
              <Pill text={`Push OK: ${deliveryStats.inferredOk}`} tone="good" />
              <Pill
                text={`Push Failed: ${deliveryStats.inferredFailed}`}
                tone="bad"
              />
              <Pill
                text={`Push Pending: ${deliveryStats.inferredPending}`}
                tone="warn"
              />
              {deliveryStats.inferredAttemptedUnknown > 0 ? (
                <Pill
                  text={`Attempted (unknown): ${deliveryStats.inferredAttemptedUnknown}`}
                  tone="info"
                />
              ) : null}
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
              <option value="pending">Pending (DB)</option>
              <option value="ok">OK (DB)</option>
              <option value="failed">Failed (DB)</option>
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
            <table className="min-w-[1200px] w-full text-sm">
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
                    Push status
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
                    In-app
                  </th>
                  <th
                    className="text-left px-4 py-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Details
                  </th>
                </tr>
              </thead>

              <tbody>
                {deliveries.map((d) => {
                  const cm = customerById[d.customer_id];

                  const attempted = inferPushAttempted(d);
                  const ok = inferPushOk(d);

                  const pushState = !attempted
                    ? "PENDING"
                    : ok === true
                    ? "OK"
                    : ok === false
                    ? "FAILED"
                    : "ATTEMPTED";

                  const isInferred = !d.push_attempted && attempted;

                  const tone: "neutral" | "good" | "warn" | "bad" =
                    pushState === "OK"
                      ? "good"
                      : pushState === "FAILED"
                      ? "bad"
                      : pushState === "PENDING"
                      ? "warn"
                      : "neutral";

                  return (
                    <tr
                      key={d.id}
                      className="border-t align-top"
                      style={{ borderColor: COLORS.cardBorder }}
                    >
                      <td
                        className="px-4 py-3"
                        style={{ color: COLORS.textSecondary }}
                      >
                        <div className="text-sm">
                          {formatDate(d.created_at)}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          {timeAgo(d.created_at)}
                        </div>
                      </td>

                      <td
                        className="px-4 py-3"
                        style={{ color: COLORS.textPrimary }}
                      >
                        <div className="font-semibold">
                          {cm?.name ? cm.name : formatShortId(d.customer_id)}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          {cm?.email
                            ? cm.email
                            : `ID: ${formatShortId(d.customer_id)}`}
                        </div>
                        <div
                          className="text-xs mt-1"
                          style={{ color: COLORS.textMuted }}
                        >
                          Delivery: {formatShortId(d.id)}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Pill
                            text={`${pushState}${
                              isInferred ? " (inferred)" : " (DB)"
                            }`}
                            tone={
                              tone === "good"
                                ? "good"
                                : tone === "bad"
                                ? "bad"
                                : tone === "warn"
                                ? "warn"
                                : "neutral"
                            }
                          />
                          <Pill
                            text={d.push_provider ?? "expo"}
                            tone="neutral"
                          />
                        </div>

                        {d.error ? (
                          <div
                            className="text-xs mt-2"
                            style={{ color: COLORS.error }}
                          >
                            {clampText(d.error, 180)}
                          </div>
                        ) : null}
                      </td>

                      <td
                        className="px-4 py-3"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {d.expo_push_token ? (
                          <Pill text="Has token" tone="good" />
                        ) : (
                          <Pill text="No token" tone="warn" />
                        )}
                      </td>

                      <td
                        className="px-4 py-3"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {d.in_app_inserted ? (
                          <Pill text="Inserted" tone="good" />
                        ) : (
                          <Pill text="Not inserted" tone="neutral" />
                        )}
                      </td>

                      <td
                        className="px-4 py-3"
                        style={{ color: COLORS.textSecondary }}
                      >
                        {d.push_response || d.error ? (
                          <details className="text-xs">
                            <summary
                              className="cursor-pointer select-none"
                              style={{ color: COLORS.textSecondary }}
                            >
                              View response
                            </summary>
                            <div
                              className="mt-2 rounded-xl border p-3 overflow-auto"
                              style={{
                                borderColor: COLORS.cardBorder,
                                backgroundColor: COLORS.screenBg,
                                color: COLORS.textSecondary,
                                maxHeight: 220,
                              }}
                            >
                              {d.error ? (
                                <div style={{ color: COLORS.error }}>
                                  <div className="font-semibold mb-1">
                                    error
                                  </div>
                                  <pre className="whitespace-pre-wrap">
                                    {d.error}
                                  </pre>
                                </div>
                              ) : null}

                              {d.push_response ? (
                                <>
                                  <div
                                    className="font-semibold mt-2 mb-1"
                                    style={{ color: COLORS.textMuted }}
                                  >
                                    push_response (JSON)
                                  </div>
                                  <pre className="whitespace-pre-wrap">
                                    {jsonPreview(d.push_response, 1800)}
                                  </pre>
                                </>
                              ) : null}
                            </div>
                          </details>
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
            Stored recipients: {campaign.recipient_count} • Loaded deliveries:{" "}
            {deliveries.length}
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
