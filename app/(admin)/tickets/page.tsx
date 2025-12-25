// app/(admin)/tickets/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

/* -------------------------------- Types --------------------------------- */

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

  // DB: tickets.ticket_code is NOT NULL
  ticket_code: string;

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

  raffle: { id: string; item_name: string } | null;
  customer: { id: string; email: string; name: string } | null;
};

const PAGE_SIZE = 25;

/* ------------------------------ Safe helpers ----------------------------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

function toStringOrEmpty(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIntOrNull(v: unknown): number | null {
  const n = toNumberOrNull(v);
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

function toBooleanOrNull(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "f" || s === "0" || s === "no") return false;
  }
  return null;
}

function safeLower(x: string | null | undefined) {
  return (x ?? "").toLowerCase().trim();
}

/**
 * Supabase Postgres timestamps often look like:
 * "2025-12-25 16:21:29.612469+00"
 * which is NOT reliably parsed by all browsers as Date.
 */
function parseDateSafe(isoish: string): Date {
  if (isoish.includes("T")) return new Date(isoish);
  const normalized = isoish.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return new Date(isoish);
  return d;
}

function shortId(id?: string | null) {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function escapeIlike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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
  return `%${s}%`;
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

/**
 * Normalize one ticket row (unknown-safe).
 * We require: id, raffle_id, customer_id, ticket_number.
 */
function normalizeTicketRow(raw: unknown): TicketRow | null {
  if (!isObj(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id : null;
  const raffle_id = typeof raw.raffle_id === "string" ? raw.raffle_id : null;
  const customer_id =
    typeof raw.customer_id === "string" ? raw.customer_id : null;

  const ticket_number = toIntOrNull(raw.ticket_number);

  if (!id || !raffle_id || !customer_id || ticket_number == null) return null;

  // DB is NOT NULL; treat missing/nullable as empty string to avoid null types.
  const ticket_code = toStringOrEmpty(raw.ticket_code);

  const payment_status =
    toStringOrEmpty(raw.payment_status).trim() || "pending";
  const payment_intent_id = toStringOrNull(raw.payment_intent_id);
  const checkout_session_id = toStringOrNull(raw.checkout_session_id);

  const payment_amount = toNumberOrNull(raw.payment_amount);
  const payment_currency = toStringOrNull(raw.payment_currency);
  const payment_method = toStringOrNull(raw.payment_method);

  const payment_completed_at = toStringOrNull(raw.payment_completed_at);
  const payment_error = toStringOrNull(raw.payment_error);

  const is_winner = toBooleanOrNull(raw.is_winner);

  const created_at = toStringOrNull(raw.created_at);

  const raffle = toRaffleSummary(raw.raffle);
  const customer = toCustomerSummary(raw.customer);

  return {
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

    raffle,
    customer,
  };
}

/* -------------------- Customers/Raffles 2-step lookups -------------------- */

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

  const rows = Array.isArray(data) ? (data as CustomerLookupRow[]) : [];
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

  const rows = Array.isArray(data) ? (data as RaffleLookupRow[]) : [];
  return rows.map((r) => r.id).filter((id) => typeof id === "string");
}

/* --------------------------------- Page --------------------------------- */

export default function AdminTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Basic
  const [status, setStatus] = useState<StatusFilter>("all");
  const [winnerOnly, setWinnerOnly] = useState(false);

  const [raffleId, setRaffleId] = useState(""); // exact
  const [customerId, setCustomerId] = useState(""); // exact

  // Ticket id deep-link support (e.g. from Notifications “Find ticket”)
  const [ticketId, setTicketId] = useState(""); // exact

  // Human lookups
  const [customerSearch, setCustomerSearch] = useState("");
  const [raffleSearch, setRaffleSearch] = useState("");

  // Debounce
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

  // IDs/refs
  const [ticketCodeQuery, setTicketCodeQuery] = useState("");
  const [ticketCodeMode, setTicketCodeMode] = useState<MatchMode>("contains");

  const [stripeRefQuery, setStripeRefQuery] = useState("");
  const [stripeRefMode, setStripeRefMode] = useState<MatchMode>("contains");
  const [stripeRefType, setStripeRefType] = useState<"all" | "pi" | "cs">(
    "all"
  );

  // Time
  const [timeField, setTimeField] = useState<TimeField>("created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendingOlderThanMinutes, setPendingOlderThanMinutes] = useState("");

  // Amount/method/currency/errors
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [errorQuery, setErrorQuery] = useState("");

  const [hasStripeRefsOnly, setHasStripeRefsOnly] = useState(false);

  /**
   * tickets.ticket_code is NOT NULL in your DB.
   * This filter now means: "legacy bad rows where ticket_code is an empty string".
   */
  const [missingTicketCodeOnly, setMissingTicketCodeOnly] = useState(false);

  // Presets
  const [preset, setPreset] = useState<PresetKey>("none");

  // Pagination
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  const totalPages = useMemo(() => {
    const pages = Math.ceil((totalCount || 0) / PAGE_SIZE);
    return Math.max(1, pages);
  }, [totalCount]);

  // URL -> State hydration
  const hydratedFromUrlRef = useRef(false);
  useEffect(() => {
    if (hydratedFromUrlRef.current) return;

    const qpStatus = safeLower(searchParams.get("status") || "");
    const qpRaffleId = (searchParams.get("raffle_id") || "").trim();
    const qpCustomerId = (searchParams.get("customer_id") || "").trim();
    const qpTicketId = (searchParams.get("ticket_id") || "").trim();

    if (qpStatus && isStatusFilter(qpStatus)) setStatus(qpStatus);
    if (qpRaffleId) setRaffleId(qpRaffleId);
    if (qpCustomerId) setCustomerId(qpCustomerId);
    if (qpTicketId) setTicketId(qpTicketId);

    hydratedFromUrlRef.current = true;
  }, [searchParams]);

  // State -> URL sync (keep your original rule: only sync these 3 params)
  const lastUrlKeyRef = useRef<string>("");
  useEffect(() => {
    if (!hydratedFromUrlRef.current) return;

    const sp = new URLSearchParams(searchParams.toString());

    if (status && status !== "all") sp.set("status", status);
    else sp.delete("status");

    const r = raffleId.trim();
    if (r) sp.set("raffle_id", r);
    else sp.delete("raffle_id");

    const c = customerId.trim();
    if (c) sp.set("customer_id", c);
    else sp.delete("customer_id");

    // ticket_id is intentionally NOT synced; it’s a deep-link convenience.
    // If it exists in URL, we keep it. If user clears it, we remove it.
    const tid = ticketId.trim();
    if (tid) sp.set("ticket_id", tid);
    else sp.delete("ticket_id");

    const nextQs = sp.toString();
    const key = `${status}|${r}|${c}|${tid}|${nextQs}`;
    if (key === lastUrlKeyRef.current) return;
    lastUrlKeyRef.current = key;

    const url = nextQs ? `/tickets?${nextQs}` : "/tickets";
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, raffleId, customerId, ticketId, router]);

  // Reset pagination whenever filters change
  useEffect(() => {
    setPage(1);
  }, [
    status,
    winnerOnly,
    raffleId,
    customerId,
    ticketId,
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

    setStatus("all");
    setWinnerOnly(false);
    setRaffleId("");
    setCustomerId("");
    setTicketId("");
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

      // Exact ticket id
      const tid = ticketId.trim();
      if (tid) query = query.eq("id", tid);

      if (status !== "all") query = query.eq("payment_status", status);
      if (winnerOnly) query = query.eq("is_winner", true);

      const raffleIdTrim = raffleId.trim();
      if (raffleIdTrim) query = query.eq("raffle_id", raffleIdTrim);

      const customerIdTrim = customerId.trim();
      if (customerIdTrim) query = query.eq("customer_id", customerIdTrim);

      if (customerIdsFromLookup && customerIdsFromLookup.length > 0) {
        query = query.in("customer_id", customerIdsFromLookup);
      }
      if (raffleIdsFromLookup && raffleIdsFromLookup.length > 0) {
        query = query.in("raffle_id", raffleIdsFromLookup);
      }

      const tc = ticketCodeQuery.trim();
      if (tc) {
        if (ticketCodeMode === "exact") query = query.eq("ticket_code", tc);
        else {
          query = query.ilike(
            "ticket_code",
            buildLikePattern(ticketCodeMode, tc)
          );
        }
      }

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

      if (hasStripeRefsOnly) {
        query = query.or(
          "payment_intent_id.not.is.null,checkout_session_id.not.is.null"
        );
      }

      // DB is NOT NULL, so "missing" means legacy empty string (if any).
      if (missingTicketCodeOnly) {
        query = query.eq("ticket_code", "");
      }

      const tf: TimeField = timeField;

      if (dateFrom) {
        const d = new Date(`${dateFrom}T00:00:00`);
        query = query.gte(tf, d.toISOString());
      }
      if (dateTo) {
        const d = new Date(`${dateTo}T23:59:59.999`);
        query = query.lte(tf, d.toISOString());
      }

      const pendingMinutes = pendingOlderThanMinutes.trim()
        ? parseInt(pendingOlderThanMinutes.trim(), 10)
        : NaN;
      if (!Number.isNaN(pendingMinutes) && pendingMinutes > 0) {
        // Forces status=pending. For pending, payment_completed_at is often null,
        // so the practical default is to use created_at; but we honor the selected field.
        query = query.eq("payment_status", "pending");
        query = query.lte(tf, isoMinusMinutes(pendingMinutes));
      }

      const min = minAmount.trim() ? parseFloat(minAmount.trim()) : NaN;
      const max = maxAmount.trim() ? parseFloat(maxAmount.trim()) : NaN;
      if (!Number.isNaN(min)) query = query.gte("payment_amount", min);
      if (!Number.isNaN(max)) query = query.lte("payment_amount", max);

      const cur = currency.trim();
      if (cur) query = query.eq("payment_currency", cur.toLowerCase());

      const pm = paymentMethod.trim();
      if (pm) query = query.ilike("payment_method", `%${escapeIlike(pm)}%`);

      const eqry = errorQuery.trim();
      if (eqry) query = query.ilike("payment_error", `%${escapeIlike(eqry)}%`);

      const res = await query.range(from, to);

      const error: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;
      const count: number | null =
        (res as { count: number | null }).count ?? null;
      const dataUnknown: unknown = (res as { data: unknown }).data ?? null;

      if (error) throw error;

      const list: unknown[] = Array.isArray(dataUnknown) ? dataUnknown : [];
      const normalized: TicketRow[] = [];

      for (const item of list) {
        const t = normalizeTicketRow(item);
        if (t) normalized.push(t);
      }

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
    ticketId,
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

  // Realtime refresh: throttle bursts
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

  const seenCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows)
      if (r.payment_currency) set.add(r.payment_currency.toUpperCase());
    return Array.from(set).sort();
  }, [rows]);

  const seenMethods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.payment_method) set.add(r.payment_method);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const ticketListQs = useMemo(() => {
    const sp = new URLSearchParams();
    if (status !== "all") sp.set("status", status);
    if (raffleId.trim()) sp.set("raffle_id", raffleId.trim());
    if (customerId.trim()) sp.set("customer_id", customerId.trim());
    if (ticketId.trim()) sp.set("ticket_id", ticketId.trim());
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
  }, [status, raffleId, customerId, ticketId]);

  // Optional: collapse “advanced”
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
            Admin view of ticket purchases across raffles. Supports filtering by
            status, winners, customer/raffle (ID or lookup), date ranges,
            amounts, Stripe refs, and error reasons.
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
              <option value="missing_ticket_code">
                Empty ticket_code (legacy)
              </option>
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
        {/* Basic */}
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
              Empty ticket_code (legacy)
            </label>

            <button
              type="button"
              className="mt-3 w-full px-3 py-2 rounded-xl text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: advancedOpen
                  ? COLORS.tabActiveBg
                  : COLORS.tabBg,
                color: COLORS.textPrimary,
              }}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? "Hide advanced filters" : "Show advanced filters"}
            </button>
          </div>

          {/* Time */}
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

        {/* Advanced */}
        {advancedOpen && (
          <div className="space-y-5">
            {/* Ticket id + Customer/Raffle */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Ticket ID (exact)
                </label>
                <input
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="uuid"
                />
                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Supports deep-links: <code>ticket_id</code>.
                </div>
              </div>

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
                  2-step lookup against customers table.
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
                  2-step lookup against raffles table.
                </div>
              </div>

              {/* Ticket code + Stripe refs */}
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

                <label
                  className="text-sm font-medium mt-3 block"
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
                    className="w-full border rounded px-3 py-2 text-sm"
                    style={{
                      borderColor: COLORS.inputBorder,
                      backgroundColor: COLORS.inputBg,
                      color: COLORS.textPrimary,
                    }}
                    placeholder="pi_... or cs_..."
                  />
                </div>

                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Ticket code + Stripe refs are ticket-side filters (no extra
                  lookup needed).
                </div>
              </div>
            </div>

            {/* Amount/currency/method/error */}
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
                    seenCurrencies.length
                      ? `e.g. ${seenCurrencies[0]}`
                      : "e.g. EUR"
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
          </div>
        )}

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
                    ? parseDateSafe(t.created_at).toLocaleString("en-IE")
                    : "—";

                  const completed = t.payment_completed_at
                    ? parseDateSafe(t.payment_completed_at).toLocaleString(
                        "en-IE"
                      )
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
                            Code: {t.ticket_code || "—"}
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
                          Completed: {completed}
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
            <code>customer_id</code>, <code>ticket_id</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
