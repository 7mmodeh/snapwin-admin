"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type PaymentStatus = "pending" | "completed" | "failed";
type StatusFilter = PaymentStatus | "all";

/**
 * Supabase nested select may return:
 * - a single object (if relationship is recognized)
 * - an array of objects (common when relationship inference differs)
 * - null
 */
type OneOrMany<T> = T | T[] | null;

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

  raffles?: {
    id: string;
    item_name: string;
  } | null;

  customers?: {
    id: string;
    email: string;
  } | null;
};

/**
 * Raw shape returned from Supabase for this query.
 * Note: nested relations can arrive as OneOrMany<...>
 */
type TicketRowRaw = Omit<TicketRow, "raffles" | "customers"> & {
  raffles?: OneOrMany<{ id: string; item_name: string }>;
  customers?: OneOrMany<{ id: string; email: string }>;
};

const PAGE_SIZE = 25;

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

function firstOrNull<T>(v: OneOrMany<T> | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function isStatusFilter(v: string): v is StatusFilter {
  return v === "all" || v === "pending" || v === "completed" || v === "failed";
}

/**
 * Escapes user input used inside ilike patterns.
 * - % and _ are wildcards in LIKE/ILIKE
 * - backslash is the escape char
 */
function escapeIlike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export default function AdminTicketsPage() {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState(""); // searches ticket_code, session_id, payment_intent_id
  const [status, setStatus] = useState<StatusFilter>("all");
  const [winnerOnly, setWinnerOnly] = useState(false);
  const [raffleId, setRaffleId] = useState("");
  const [customerId, setCustomerId] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Debounce query so we don’t spam Supabase
  const qRef = useRef<number | null>(null);
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    if (qRef.current) window.clearTimeout(qRef.current);
    qRef.current = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => {
      if (qRef.current) window.clearTimeout(qRef.current);
    };
  }, [q]);

  const totalPages = useMemo(() => {
    const pages = Math.ceil((totalCount || 0) / PAGE_SIZE);
    return Math.max(1, pages);
  }, [totalCount]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [qDebounced, status, winnerOnly, raffleId, customerId]);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

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
            raffles ( id, item_name ),
            customers ( id, email )
          `,
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      // Filters
      if (status !== "all") query = query.eq("payment_status", status);
      if (winnerOnly) query = query.eq("is_winner", true);
      if (raffleId.trim()) query = query.eq("raffle_id", raffleId.trim());
      if (customerId.trim()) query = query.eq("customer_id", customerId.trim());

      // Ticket-side search only (safe / reliable)
      const search = qDebounced;
      if (search) {
        // Avoid LIKE wildcard surprises and keep queries consistent
        const s = escapeIlike(search);

        query = query.or(
          [
            `ticket_code.ilike.%${s}%`,
            `checkout_session_id.ilike.%${s}%`,
            `payment_intent_id.ilike.%${s}%`,
          ].join(",")
        );
      }

      // Fetch and then normalize types explicitly (prevents `any` + “conversion may be a mistake” warnings)
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

      // Normalize nested relations so UI always receives single objects or null
      const normalized: TicketRow[] = rawRows.map((r) => ({
        ...r,
        raffles: firstOrNull(r.raffles),
        customers: firstOrNull(r.customers),
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
  }, [page, qDebounced, status, winnerOnly, raffleId, customerId]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Realtime refresh: if any ticket changes, re-fetch current page.
  // Throttle bursts to a single fetch (prevents “spam fetch” during draws/imports)
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
            winners, raffle/customer IDs, and search by payment/session
            identifiers.
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

      {/* Filters */}
      <div
        className="rounded-2xl p-5 border space-y-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-2 md:col-span-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Search (ticket code / checkout session / payment intent)
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="e.g. SW-000123-AB12CD or cs_test_... or pi_..."
            />
            <p className="text-xs" style={{ color: COLORS.textMuted }}>
              This search targets ticket fields only. For customer email search,
              add a 2-step lookup later.
            </p>
          </div>

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

            <div className="flex gap-2">
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
                  const raffleName = t.raffles?.item_name ?? "—";
                  const custEmail = t.customers?.email ?? "—";
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
                            href={`/tickets/${t.id}`}
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
                            {custEmail}
                          </Link>
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

      {/* Admin ops notes */}
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
          <li>Audit all purchases by status (completed/pending/failed).</li>
          <li>Investigate failed payments (view error + Stripe references).</li>
          <li>Confirm winning tickets (filter Winner tickets only).</li>
          <li>
            Jump to the related customer page or raffle page for deeper context.
          </li>
          <li>Realtime refresh on any ticket insert/update/delete.</li>
        </ul>
      </div>
    </div>
  );
}
