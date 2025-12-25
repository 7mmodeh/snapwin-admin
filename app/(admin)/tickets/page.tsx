// app/(admin)/tickets/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type PaymentStatus = "pending" | "completed" | "failed";
type StatusFilter = PaymentStatus | "all";

type MatchMode = "contains" | "starts" | "exact";
type TimeField = "created_at" | "payment_completed_at";
type PresetKey =
  | "none"
  | "today"
  | "last7"
  | "last30"
  | "failed_today"
  | "pending_gt_2h"
  | "winners_30d"
  | "high_value_7d"
  | "has_stripe_refs"
  | "missing_ticket_code";

type TicketRow = {
  id: string;
  raffle_id: string;
  customer_id: string;
  ticket_number: number;
  ticket_code: string | null;

  payment_status: PaymentStatus | string;
  payment_intent_id: string | null;
  checkout_session_id: string | null;

  payment_amount: number | null;
  payment_currency: string | null;
  payment_method: string | null;

  payment_completed_at: string | null;
  payment_error: string | null;

  is_winner: boolean | null;

  created_at: string | null;

  // Explicit FK embedding + stable aliases
  raffle: { id: string; item_name: string } | null;
  customer: { id: string; email: string; name: string } | null;
};

type TicketRowRaw = Omit<TicketRow, "raffle" | "customer"> & {
  raffle?: unknown;
  customer?: unknown;
};

const PAGE_SIZE = 25;

// ---------- Formatting / helpers ----------
function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  const c = (currency || "eur").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

function shortId(id?: string | null) {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function isStatusFilter(v: string): v is StatusFilter {
  return v === "all" || v === "pending" || v === "completed" || v === "failed";
}

function isMatchMode(v: string): v is MatchMode {
  return v === "contains" || v === "starts" || v === "exact";
}

function isTimeField(v: string): v is TimeField {
  return v === "created_at" || v === "payment_completed_at";
}

function escapeIlike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toRaffleSummary(v: unknown): TicketRow["raffle"] {
  if (!isObj(v)) return null;
  const id = typeof v.id === "string" ? v.id : null;
  const item_name = typeof v.item_name === "string" ? v.item_name : null;
  if (!id || !item_name) return null;
  return { id, item_name };
}

function toCustomerSummary(v: unknown): TicketRow["customer"] {
  if (!isObj(v)) return null;
  const id = typeof v.id === "string" ? v.id : null;
  const email = typeof v.email === "string" ? v.email : null;
  const name = typeof v.name === "string" ? v.name : null;
  if (!id || !email || !name) return null;
  return { id, email, name };
}

function isoAtStartOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function isoAtEndOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}
function isoMinusDays(days: number) {
  const x = new Date();
  x.setDate(x.getDate() - days);
  return x.toISOString();
}
function isoMinusMinutes(minutes: number) {
  const x = new Date();
  x.setMinutes(x.getMinutes() - minutes);
  return x.toISOString();
}

function buildLikePattern(mode: MatchMode, raw: string) {
  const s = escapeIlike(raw.trim());
  if (!s) return "";
  if (mode === "exact") return s; // handled via eq
  if (mode === "starts") return `${s}%`;
  return `%${s}%`; // contains
}

// ---------- Customers/Raffles 2-step lookups ----------
type CustomerLookupRow = { id: string };
type RaffleLookupRow = { id: string };

async function lookupCustomerIdsByNameOrEmail(
  search: string,
  limit = 50
): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];
  const s = escapeIlike(q);
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .or([`name.ilike.%${s}%`, `email.ilike.%${s}%`].join(","))
    .limit(limit);

  if (error) throw error;
  const rows = (data ?? []) as CustomerLookupRow[];
  return rows.map((r) => r.id).filter((id) => typeof id === "string");
}

async function lookupRaffleIdsByItemName(
  search: string,
  limit = 50
): Promise<string[]> {
  const q = search.trim();
  if (!q) return [];
  const s = escapeIlike(q);
  const { data, error } = await supabase
    .from("raffles")
    .select("id")
    .ilike("item_name", `%${s}%`)
    .limit(limit);

  if (error) throw error;
  const rows = (data ?? []) as RaffleLookupRow[];
  return rows.map((r) => r.id).filter((id) => typeof id === "string");
}

export default function AdminTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // -----------------------------
  // Filters (basic)
  // -----------------------------
  const [status, setStatus] = useState<StatusFilter>("all");
  const [winnerOnly, setWinnerOnly] = useState(false);

  const [raffleId, setRaffleId] = useState(""); // exact
  const [customerId, setCustomerId] = useState(""); // exact

  // -----------------------------
  // Filters (human-friendly lookups)
  // -----------------------------
  const [customerSearch, setCustomerSearch] = useState(""); // name/email
  const [raffleSearch, setRaffleSearch] = useState(""); // item_name

  // Debounce customer/raffle search inputs
  const custTimer = useRef<number | null>(null);
  const raffleTimer = useRef<number | null>(null);

  const [customerSearchDebounced, setCustomerSearchDebounced] = useState("");
  const [raffleSearchDebounced, setRaffleSearchDebounced] = useState("");

  useEffect(() => {
    if (custTimer.current) window.clearTimeout(custTimer.current);
    custTimer.current = window.setTimeout(
      () => setCustomerSearchDebounced(customerSearch.trim()),
      250
    );
    return () => {
      if (custTimer.current) window.clearTimeout(custTimer.current);
    };
  }, [customerSearch]);

  useEffect(() => {
    if (raffleTimer.current) window.clearTimeout(raffleTimer.current);
    raffleTimer.current = window.setTimeout(
      () => setRaffleSearchDebounced(raffleSearch.trim()),
      250
    );
    return () => {
      if (raffleTimer.current) window.clearTimeout(raffleTimer.current);
    };
  }, [raffleSearch]);

  // -----------------------------
  // Filters (IDs / refs)
  // -----------------------------
  const [ticketCodeQuery, setTicketCodeQuery] = useState("");
  const [ticketCodeMode, setTicketCodeMode] = useState<MatchMode>("contains");

  const [stripeRefQuery, setStripeRefQuery] = useState("");
  const [stripeRefMode, setStripeRefMode] = useState<MatchMode>("contains");
  const [stripeRefType, setStripeRefType] = useState<"all" | "pi" | "cs">(
    "all"
  );

  // -----------------------------
  // Filters (time)
  // -----------------------------
  const [timeField, setTimeField] = useState<TimeField>("created_at"); // created or completed
  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd
  const [dateTo, setDateTo] = useState(""); // yyyy-mm-dd
  const [pendingOlderThanMinutes, setPendingOlderThanMinutes] = useState(""); // number input

  // -----------------------------
  // Filters (amount/method/currency/errors)
  // -----------------------------
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [currency, setCurrency] = useState(""); // exact, optional
  const [paymentMethod, setPaymentMethod] = useState(""); // ilike, optional
  const [errorQuery, setErrorQuery] = useState(""); // ilike, optional

  const [hasStripeRefsOnly, setHasStripeRefsOnly] = useState(false);
  const [missingTicketCodeOnly, setMissingTicketCodeOnly] = useState(false);

  // -----------------------------
  // Saved views / presets
  // -----------------------------
  const [preset, setPreset] = useState<PresetKey>("none");

  // -----------------------------
  // Pagination
  // -----------------------------
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  const totalPages = useMemo(() => {
    const pages = Math.ceil((totalCount || 0) / PAGE_SIZE);
    return Math.max(1, pages);
  }, [totalCount]);

  // -----------------------------
  // URL -> State hydration (raffle_id, customer_id, status)
  // -----------------------------
  const hydratedFromUrlRef = useRef(false);
  useEffect(() => {
    if (hydratedFromUrlRef.current) return;

    const qpStatus = (searchParams.get("status") || "").trim().toLowerCase();
    const qpRaffleId = (searchParams.get("raffle_id") || "").trim();
    const qpCustomerId = (searchParams.get("customer_id") || "").trim();

    if (qpStatus && isStatusFilter(qpStatus)) setStatus(qpStatus);
    if (qpRaffleId) setRaffleId(qpRaffleId);
    if (qpCustomerId) setCustomerId(qpCustomerId);

    hydratedFromUrlRef.current = true;
  }, [searchParams]);

  // -----------------------------
  // State -> URL sync (only these 3 params)
  // -----------------------------
  const lastUrlKeyRef = useRef<string>("");
  useEffect(() => {
    if (!hydratedFromUrlRef.current) return;

    const sp = new URLSearchParams(searchParams.toString());

    // status
    if (status && status !== "all") sp.set("status", status);
    else sp.delete("status");

    // raffle_id
    const r = raffleId.trim();
    if (r) sp.set("raffle_id", r);
    else sp.delete("raffle_id");

    // customer_id
    const c = customerId.trim();
    if (c) sp.set("customer_id", c);
    else sp.delete("customer_id");

    const nextQs = sp.toString();
    const key = `${status}|${r}|${c}|${nextQs}`;

    if (key === lastUrlKeyRef.current) return;
    lastUrlKeyRef.current = key;

    const url = nextQs ? `/tickets?${nextQs}` : "/tickets";
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, raffleId, customerId, router]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [
    status,
    winnerOnly,
    raffleId,
    customerId,
    customerSearchDebounced,
    raffleSearchDebounced,
    ticketCodeQuery,
    ticketCodeMode,
    stripeRefQuery,
    stripeRefMode,
    stripeRefType,
    timeField,
    dateFrom,
    dateTo,
    pendingOlderThanMinutes,
    minAmount,
    maxAmount,
    currency,
    paymentMethod,
    errorQuery,
    hasStripeRefsOnly,
    missingTicketCodeOnly,
    preset,
  ]);

  const applyPreset = useCallback((p: PresetKey) => {
    setPreset(p);

    // Clear commonly conflicting filters first
    setStatus("all");
    setWinnerOnly(false);
    setRaffleId("");
    setCustomerId("");
    setCustomerSearch("");
    setRaffleSearch("");
    setTicketCodeQuery("");
    setStripeRefQuery("");
    setHasStripeRefsOnly(false);
    setMissingTicketCodeOnly(false);
    setErrorQuery("");
    setMinAmount("");
    setMaxAmount("");
    setCurrency("");
    setPaymentMethod("");
    setPendingOlderThanMinutes("");
    setTimeField("created_at");
    setDateFrom("");
    setDateTo("");

    const today = new Date();
    const todayFrom = isoAtStartOfDayLocal(today);
    const todayTo = isoAtEndOfDayLocal(today);

    if (p === "today") {
      setTimeField("created_at");
      setDateFrom(todayFrom.slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      return;
    }

    if (p === "last7") {
      setTimeField("created_at");
      setDateFrom(isoMinusDays(7).slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      return;
    }

    if (p === "last30") {
      setTimeField("created_at");
      setDateFrom(isoMinusDays(30).slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      return;
    }

    if (p === "failed_today") {
      setStatus("failed");
      setTimeField("created_at");
      setDateFrom(todayFrom.slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      return;
    }

    if (p === "pending_gt_2h") {
      setStatus("pending");
      setPendingOlderThanMinutes(String(120));
      setTimeField("created_at");
      return;
    }

    if (p === "winners_30d") {
      setWinnerOnly(true);
      setTimeField("created_at");
      setDateFrom(isoMinusDays(30).slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      return;
    }

    if (p === "high_value_7d") {
      setTimeField("created_at");
      setDateFrom(isoMinusDays(7).slice(0, 10));
      setDateTo(todayTo.slice(0, 10));
      setMinAmount("10");
      return;
    }

    if (p === "has_stripe_refs") {
      setHasStripeRefsOnly(true);
      return;
    }

    if (p === "missing_ticket_code") {
      setMissingTicketCodeOnly(true);
      return;
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // 2-step lookups (only when the human-friendly filter is used)
      let customerIdsFromLookup: string[] | null = null;
      let raffleIdsFromLookup: string[] | null = null;

      if (customerSearchDebounced) {
        customerIdsFromLookup = await lookupCustomerIdsByNameOrEmail(
          customerSearchDebounced,
          50
        );

        if (customerIdsFromLookup.length === 0) {
          setRows([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }
      }

      if (raffleSearchDebounced) {
        raffleIdsFromLookup = await lookupRaffleIdsByItemName(
          raffleSearchDebounced,
          50
        );

        if (raffleIdsFromLookup.length === 0) {
          setRows([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }
      }

      let query = supabase
        .from("tickets")
        .select(
          `
            id,
            raffle_id,
            customer_id,
            ticket_number,
            ticket_code,
            payment_status,
            payment_intent_id,
            checkout_session_id,
            payment_amount,
            payment_currency,
            payment_method,
            payment_completed_at,
            payment_error,
            is_winner,
            created_at,
            raffle:raffles!tickets_raffle_id_fkey ( id, item_name ),
            customer:customers!tickets_customer_id_fkey ( id, email, name )
          `,
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      // ---- Basic filters
      if (status !== "all") query = query.eq("payment_status", status);
      if (winnerOnly) query = query.eq("is_winner", true);

      const raffleIdTrim = raffleId.trim();
      if (raffleIdTrim) query = query.eq("raffle_id", raffleIdTrim);

      const customerIdTrim = customerId.trim();
      if (customerIdTrim) query = query.eq("customer_id", customerIdTrim);

      // ---- 2-step lookup filters
      if (customerIdsFromLookup && customerIdsFromLookup.length > 0) {
        query = query.in("customer_id", customerIdsFromLookup);
      }
      if (raffleIdsFromLookup && raffleIdsFromLookup.length > 0) {
        query = query.in("raffle_id", raffleIdsFromLookup);
      }

      // ---- Ticket code filter
      const tc = ticketCodeQuery.trim();
      if (tc) {
        if (ticketCodeMode === "exact") {
          query = query.eq("ticket_code", tc);
        } else {
          query = query.ilike(
            "ticket_code",
            buildLikePattern(ticketCodeMode, tc)
          );
        }
      }

      // ---- Stripe ref filter (PI / CS)
      const sr = stripeRefQuery.trim();
      if (sr) {
        if (stripeRefMode === "exact") {
          if (stripeRefType === "pi") query = query.eq("payment_intent_id", sr);
          else if (stripeRefType === "cs")
            query = query.eq("checkout_session_id", sr);
          else {
            query = query.or(
              [
                `payment_intent_id.eq.${sr}`,
                `checkout_session_id.eq.${sr}`,
              ].join(",")
            );
          }
        } else {
          const pat = buildLikePattern(stripeRefMode, sr);
          if (stripeRefType === "pi")
            query = query.ilike("payment_intent_id", pat);
          else if (stripeRefType === "cs")
            query = query.ilike("checkout_session_id", pat);
          else {
            query = query.or(
              [
                `payment_intent_id.ilike.${pat}`,
                `checkout_session_id.ilike.${pat}`,
              ].join(",")
            );
          }
        }
      }

      // ---- Has Stripe refs only
      if (hasStripeRefsOnly) {
        query = query.or(
          "payment_intent_id.not.is.null,checkout_session_id.not.is.null"
        );
      }

      // ---- Missing ticket_code only
      if (missingTicketCodeOnly) {
        query = query.or("ticket_code.is.null,ticket_code.eq.");
      }

      // ---- Time filters
      const tf: TimeField = timeField;

      if (dateFrom) {
        const d = new Date(`${dateFrom}T00:00:00`);
        query = query.gte(tf, d.toISOString());
      }
      if (dateTo) {
        const d = new Date(`${dateTo}T23:59:59.999`);
        query = query.lte(tf, d.toISOString());
      }

      // ---- Pending older than N minutes
      const pendingMinutes = pendingOlderThanMinutes.trim()
        ? parseInt(pendingOlderThanMinutes.trim(), 10)
        : NaN;
      if (!Number.isNaN(pendingMinutes) && pendingMinutes > 0) {
        query = query.eq("payment_status", "pending");
        query = query.lte(tf, isoMinusMinutes(pendingMinutes));
      }

      // ---- Amount filters
      const min = minAmount.trim() ? parseFloat(minAmount.trim()) : NaN;
      const max = maxAmount.trim() ? parseFloat(maxAmount.trim()) : NaN;

      if (!Number.isNaN(min)) query = query.gte("payment_amount", min);
      if (!Number.isNaN(max)) query = query.lte("payment_amount", max);

      // ---- Currency filter (exact)
      const cur = currency.trim();
      if (cur) query = query.eq("payment_currency", cur.toLowerCase());

      // ---- Payment method filter (ilike)
      const pm = paymentMethod.trim();
      if (pm) query = query.ilike("payment_method", `%${escapeIlike(pm)}%`);

      // ---- Error filter (ilike)
      const eqry = errorQuery.trim();
      if (eqry) query = query.ilike("payment_error", `%${escapeIlike(eqry)}%`);

      // Fetch
      const res = await query.range(from, to);

      const error: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;
      const count: number | null =
        (res as { count: number | null }).count ?? null;
      const dataUnknown: unknown = (res as { data: unknown }).data ?? null;

      if (error) throw error;

      const rawRows: TicketRowRaw[] = Array.isArray(dataUnknown)
        ? (dataUnknown as unknown as TicketRowRaw[])
        : [];

      const normalized: TicketRow[] = rawRows.map((r) => ({
        id: r.id,
        raffle_id: r.raffle_id,
        customer_id: r.customer_id,
        ticket_number: r.ticket_number,
        ticket_code: r.ticket_code ?? null,

        payment_status: r.payment_status,
        payment_intent_id: r.payment_intent_id ?? null,
        checkout_session_id: r.checkout_session_id ?? null,

        payment_amount: r.payment_amount ?? null,
        payment_currency: r.payment_currency ?? null,
        payment_method: r.payment_method ?? null,

        payment_completed_at: r.payment_completed_at ?? null,
        payment_error: r.payment_error ?? null,

        is_winner: r.is_winner ?? null,
        created_at: r.created_at ?? null,

        raffle: toRaffleSummary((r as TicketRowRaw).raffle),
        customer: toCustomerSummary((r as TicketRowRaw).customer),
      }));

      setRows(normalized);
      setTotalCount(count ?? 0);
    } catch (err: unknown) {
      console.error("Admin tickets fetch error:", err);
      setFetchError(
        err instanceof Error ? err.message : "Failed to load tickets."
      );
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    status,
    winnerOnly,
    raffleId,
    customerId,
    customerSearchDebounced,
    raffleSearchDebounced,
    ticketCodeQuery,
    ticketCodeMode,
    stripeRefQuery,
    stripeRefMode,
    stripeRefType,
    timeField,
    dateFrom,
    dateTo,
    pendingOlderThanMinutes,
    minAmount,
    maxAmount,
    currency,
    paymentMethod,
    errorQuery,
    hasStripeRefsOnly,
    missingTicketCodeOnly,
  ]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Realtime refresh: throttle bursts to a single fetch
  const rtTimerRef = useRef<number | null>(null);
  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    channel = supabase
      .channel("admin_tickets_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => {
          if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
          rtTimerRef.current = window.setTimeout(() => {
            fetchTickets();
          }, 200);
        }
      )
      .subscribe();

    return () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchTickets]);

  // Optional: derive a small set of “seen” currencies/methods for convenience
  const seenCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.payment_currency) set.add(r.payment_currency.toUpperCase());
    }
    return Array.from(set).sort();
  }, [rows]);

  const seenMethods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.payment_method) set.add(r.payment_method);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Preserve current list filters when navigating into /tickets/[id]
  const ticketListQs = useMemo(() => {
    const sp = new URLSearchParams();
    if (status !== "all") sp.set("status", status);
    if (raffleId.trim()) sp.set("raffle_id", raffleId.trim());
    if (customerId.trim()) sp.set("customer_id", customerId.trim());
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
  }, [status, raffleId, customerId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Tickets
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Admin view of all ticket purchases across raffles. Filter by status,
            winners, customer/raffle (by ID or by name), date ranges, amounts,
            Stripe references, and error reasons.
          </p>
        </div>

        <div
          className="rounded-2xl px-4 py-3 border text-sm"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            color: COLORS.textSecondary,
            boxShadow: `0 12px 30px ${COLORS.cardShadow}`,
          }}
        >
          <div className="flex gap-4 flex-wrap">
            <div>
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Total tickets
              </div>
              <div
                className="font-semibold"
                style={{ color: COLORS.textPrimary }}
              >
                {loading ? "—" : totalCount.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Page
              </div>
              <div
                className="font-semibold"
                style={{ color: COLORS.textPrimary }}
              >
                {page} / {totalPages}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Presets */}
      <div
        className="rounded-2xl p-4 border"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Saved views
            </div>
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              One-click presets for common admin checks.
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={preset}
              onChange={(e) => applyPreset(e.target.value as PresetKey)}
              className="border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="none">None</option>
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="failed_today">Failed today</option>
              <option value="pending_gt_2h">Pending &gt; 2 hours</option>
              <option value="winners_30d">Winners (last 30 days)</option>
              <option value="high_value_7d">
                High value (min €10, last 7 days)
              </option>
              <option value="has_stripe_refs">Has Stripe refs</option>
              <option value="missing_ticket_code">Missing ticket code</option>
            </select>

            <button
              type="button"
              onClick={() => applyPreset("today")}
              className="px-3 py-2 rounded-full text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.cardBg,
                color: COLORS.textSecondary,
              }}
              disabled={loading}
            >
              Today
            </button>

            <button
              type="button"
              onClick={() => applyPreset("failed_today")}
              className="px-3 py-2 rounded-full text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.cardBg,
                color: COLORS.textSecondary,
              }}
              disabled={loading}
            >
              Failed today
            </button>

            <button
              type="button"
              onClick={() => applyPreset("pending_gt_2h")}
              className="px-3 py-2 rounded-full text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.cardBg,
                color: COLORS.textSecondary,
              }}
              disabled={loading}
            >
              Pending &gt; 2h
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div
        className="rounded-2xl p-5 border space-y-5"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        {/* Row 1: status/winner + time */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Payment status
            </label>
            <select
              value={status}
              onChange={(e) => {
                const v = e.target.value;
                if (isStatusFilter(v)) setStatus(v);
              }}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>

            <label
              className="flex items-center gap-2 text-sm mt-2"
              style={{ color: COLORS.textSecondary }}
            >
              <input
                type="checkbox"
                checked={winnerOnly}
                onChange={(e) => setWinnerOnly(e.target.checked)}
              />
              Winner tickets only
            </label>

            <label
              className="flex items-center gap-2 text-sm mt-2"
              style={{ color: COLORS.textSecondary }}
            >
              <input
                type="checkbox"
                checked={hasStripeRefsOnly}
                onChange={(e) => setHasStripeRefsOnly(e.target.checked)}
              />
              Has Stripe refs (PI or CS)
            </label>

            <label
              className="flex items-center gap-2 text-sm mt-2"
              style={{ color: COLORS.textSecondary }}
            >
              <input
                type="checkbox"
                checked={missingTicketCodeOnly}
                onChange={(e) => setMissingTicketCodeOnly(e.target.checked)}
              />
              Missing ticket_code
            </label>
          </div>

          <div className="space-y-2 md:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Time field
                </label>
                <select
                  value={timeField}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isTimeField(v)) setTimeField(v);
                  }}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                >
                  <option value="created_at">Created at</option>
                  <option value="payment_completed_at">Completed at</option>
                </select>
                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Date range applies to this field.
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Date from
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Date to
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Pending older than (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={pendingOlderThanMinutes}
                  onChange={(e) => setPendingOlderThanMinutes(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="e.g. 120"
                />
                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Forces status=pending; compares against selected time field.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setDateFrom(isoAtStartOfDayLocal(today).slice(0, 10));
                  setDateTo(isoAtEndOfDayLocal(today).slice(0, 10));
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Today
              </button>

              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setDateFrom(isoMinusDays(7).slice(0, 10));
                  setDateTo(isoAtEndOfDayLocal(today).slice(0, 10));
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Last 7 days
              </button>

              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setDateFrom(isoMinusDays(30).slice(0, 10));
                  setDateTo(isoAtEndOfDayLocal(today).slice(0, 10));
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Last 30 days
              </button>

              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Clear dates
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Customer/Raffle by ID + by name */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Customer ID (exact)
            </label>
            <input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="uuid"
            />

            <label
              className="text-sm font-medium mt-3 block"
              style={{ color: COLORS.textSecondary }}
            >
              Customer (name or email)
            </label>
            <input
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. Mohammad or gmail.com"
            />
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Uses a 2-step lookup against customers table.
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Raffle ID (exact)
            </label>
            <input
              value={raffleId}
              onChange={(e) => setRaffleId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="uuid"
            />

            <label
              className="text-sm font-medium mt-3 block"
              style={{ color: COLORS.textSecondary }}
            >
              Raffle (item name)
            </label>
            <input
              value={raffleSearch}
              onChange={(e) => setRaffleSearch(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. iPhone, AirPods..."
            />
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Uses a 2-step lookup against raffles table.
            </div>
          </div>

          {/* Row 2 continued: ticket code and Stripe refs */}
          <div className="space-y-2 md:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Ticket code
                </label>
                <div className="flex gap-2">
                  <select
                    value={ticketCodeMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (isMatchMode(v)) setTicketCodeMode(v);
                    }}
                    className="border rounded px-2 py-2 text-sm"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                  >
                    <option value="contains">Contains</option>
                    <option value="starts">Starts</option>
                    <option value="exact">Exact</option>
                  </select>

                  <input
                    value={ticketCodeQuery}
                    onChange={(e) => setTicketCodeQuery(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                    placeholder="e.g. SW-000123-AB12CD"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Stripe reference
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select
                    value={stripeRefType}
                    onChange={(e) =>
                      setStripeRefType(e.target.value as "all" | "pi" | "cs")
                    }
                    className="border rounded px-2 py-2 text-sm"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                  >
                    <option value="all">PI or CS</option>
                    <option value="pi">Payment Intent (pi_)</option>
                    <option value="cs">Checkout Session (cs_)</option>
                  </select>

                  <select
                    value={stripeRefMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (isMatchMode(v)) setStripeRefMode(v);
                    }}
                    className="border rounded px-2 py-2 text-sm"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                  >
                    <option value="contains">Contains</option>
                    <option value="starts">Starts</option>
                    <option value="exact">Exact</option>
                  </select>

                  <input
                    value={stripeRefQuery}
                    onChange={(e) => setStripeRefQuery(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm md:col-span-1"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                    placeholder="pi_... or cs_..."
                  />
                </div>
              </div>
            </div>

            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Ticket code + Stripe refs are ticket-side filters (no extra lookup
              needed).
            </div>
          </div>
        </div>

        {/* Row 3: amount/currency/method/error */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Min amount
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. 5"
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Max amount
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. 50"
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Currency (exact)
            </label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder={
                seenCurrencies.length ? `e.g. ${seenCurrencies[0]}` : "e.g. EUR"
              }
            />
            {seenCurrencies.length > 0 ? (
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Seen: {seenCurrencies.join(", ")}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Payment method (contains)
            </label>
            <input
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder={
                seenMethods.length ? `e.g. ${seenMethods[0]}` : "e.g. card"
              }
            />
            {seenMethods.length > 0 ? (
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Seen: {seenMethods.slice(0, 6).join(", ")}
                {seenMethods.length > 6 ? "…" : ""}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 md:col-span-4">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Error reason (contains)
            </label>
            <input
              value={errorQuery}
              onChange={(e) => setErrorQuery(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. insufficient, authentication, expired, webhook..."
            />
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Matches payment_error via ILIKE. Useful for triage across
              failed/pending workflows.
            </div>
          </div>
        </div>

        {fetchError && (
          <div
            className="rounded-2xl px-4 py-3 text-sm border"
            style={{
              backgroundColor: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: COLORS.error,
            }}
          >
            {fetchError}
          </div>
        )}
      </div>

      {/* Table */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div className="flex items-center justify-between gap-3">
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Results
            </div>

            <button
              type="button"
              onClick={() => fetchTickets()}
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left"
                style={{
                  backgroundColor: COLORS.highlightCardBg,
                  color: COLORS.textSecondary,
                }}
              >
                <th className="px-5 py-3 font-medium">Ticket</th>
                <th className="px-5 py-3 font-medium">Raffle</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Refs</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    className="px-5 py-6"
                    colSpan={7}
                    style={{ color: COLORS.textSecondary }}
                  >
                    Loading tickets...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    className="px-5 py-6"
                    colSpan={7}
                    style={{ color: COLORS.textSecondary }}
                  >
                    No tickets found for the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const raffleName = t.raffle?.item_name ?? "—";
                  const custName = t.customer?.name ?? "—";
                  const custEmail = t.customer?.email ?? "—";

                  const created = t.created_at
                    ? new Date(t.created_at).toLocaleString("en-IE")
                    : "—";

                  const statusLabel =
                    t.payment_status === "completed"
                      ? "Completed"
                      : t.payment_status === "pending"
                      ? "Pending"
                      : t.payment_status === "failed"
                      ? "Failed"
                      : t.payment_status;

                  const statusBg =
                    t.payment_status === "completed"
                      ? "#ECFDF5"
                      : t.payment_status === "pending"
                      ? "#FFFBEB"
                      : t.payment_status === "failed"
                      ? "#FEF2F2"
                      : COLORS.highlightCardBg;

                  const statusBorder =
                    t.payment_status === "completed"
                      ? "#6EE7B7"
                      : t.payment_status === "pending"
                      ? "#FCD34D"
                      : t.payment_status === "failed"
                      ? "#FCA5A5"
                      : COLORS.cardBorder;

                  const statusColor =
                    t.payment_status === "failed"
                      ? COLORS.error
                      : COLORS.textPrimary;

                  return (
                    <tr
                      key={t.id}
                      className="border-t"
                      style={{ borderColor: COLORS.cardBorder }}
                    >
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/tickets/${t.id}${ticketListQs}`}
                            className="font-semibold underline"
                            style={{ color: COLORS.primary }}
                          >
                            #{t.ticket_number}
                            {t.is_winner ? " • WINNER" : ""}
                          </Link>

                          <div
                            className="text-xs"
                            style={{ color: COLORS.textMuted }}
                          >
                            Code: {t.ticket_code ?? "—"}
                          </div>

                          <div
                            className="text-xs"
                            style={{ color: COLORS.textMuted }}
                          >
                            ID: {shortId(t.id)}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/raffles/${t.raffle_id}`}
                            className="underline"
                            style={{ color: COLORS.primary }}
                          >
                            {raffleName}
                          </Link>
                          <div
                            className="text-xs"
                            style={{ color: COLORS.textMuted }}
                          >
                            {shortId(t.raffle_id)}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/customers/${t.customer_id}`}
                            className="underline"
                            style={{ color: COLORS.primary }}
                          >
                            {custName}
                          </Link>

                          <div
                            className="text-xs"
                            style={{ color: COLORS.textMuted }}
                          >
                            {custEmail}
                          </div>

                          <div
                            className="text-xs"
                            style={{ color: COLORS.textMuted }}
                          >
                            {shortId(t.customer_id)}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium"
                          style={{
                            backgroundColor: statusBg,
                            borderColor: statusBorder,
                            color: statusColor,
                          }}
                        >
                          {statusLabel}
                        </span>

                        {t.payment_status === "failed" && t.payment_error ? (
                          <div
                            className="text-xs mt-1"
                            style={{ color: COLORS.textMuted }}
                          >
                            {t.payment_error.slice(0, 80)}
                            {t.payment_error.length > 80 ? "…" : ""}
                          </div>
                        ) : null}
                      </td>

                      <td
                        className="px-5 py-4"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {formatMoney(t.payment_amount, t.payment_currency)}
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          Method: {t.payment_method ?? "—"}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          Currency:{" "}
                          {t.payment_currency
                            ? t.payment_currency.toUpperCase()
                            : "—"}
                        </div>
                      </td>

                      <td
                        className="px-5 py-4"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {created}
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          Completed:{" "}
                          {t.payment_completed_at
                            ? new Date(t.payment_completed_at).toLocaleString(
                                "en-IE"
                              )
                            : "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          PI: {shortId(t.payment_intent_id)}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textMuted }}
                        >
                          CS: {shortId(t.checkout_session_id)}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          className="flex items-center justify-between px-5 py-4 border-t"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div className="text-sm" style={{ color: COLORS.textSecondary }}>
            {totalCount > 0 ? (
              <>
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, totalCount)} of{" "}
                {totalCount.toLocaleString()}
              </>
            ) : (
              <>Showing 0 of 0</>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-full text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                color: COLORS.textSecondary,
                backgroundColor: COLORS.cardBg,
                opacity: page <= 1 ? 0.5 : 1,
              }}
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>

            <button
              type="button"
              className="px-4 py-2 rounded-full text-sm font-medium"
              style={{
                backgroundColor: COLORS.primaryButtonBg,
                color: COLORS.primaryButtonText,
                opacity: page >= totalPages ? 0.5 : 1,
              }}
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div
        className="rounded-2xl p-5 border text-sm"
        style={{
          backgroundColor: COLORS.highlightCardBg,
          borderColor: COLORS.cardBorder,
          color: COLORS.textSecondary,
        }}
      >
        <div
          className="font-semibold mb-2"
          style={{ color: COLORS.textPrimary }}
        >
          Typical admin use cases covered here
        </div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Audit purchases by status (completed/pending/failed).</li>
          <li>Investigate failed payments (error + Stripe references).</li>
          <li>Confirm winners (Winner tickets only).</li>
          <li>
            Filter by customer name/email and raffle item name (2-step lookup).
          </li>
          <li>
            Operational triage: pending older than N minutes, error reason, has
            Stripe refs.
          </li>
          <li>Realtime refresh on any ticket insert/update/delete.</li>
          <li>
            URL params supported: <code>status</code>, <code>raffle_id</code>,{" "}
            <code>customer_id</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
