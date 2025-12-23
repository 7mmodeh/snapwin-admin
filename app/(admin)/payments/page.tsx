// app/(admin)/payments/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type PaymentStatus = "pending" | "completed" | "failed";
type StatusFilter = "all" | PaymentStatus;

type PaymentViewRow = {
  ticket_id: string;
  raffle_id: string;
  customer_id: string;

  ticket_number: number;
  ticket_code: string | null;

  payment_status: PaymentStatus;
  payment_intent_id: string | null;
  checkout_session_id: string | null;

  payment_amount: number | string | null;
  payment_currency: string | null;
  payment_method: string | null;

  payment_completed_at: string | null;
  payment_error: string | null;

  purchased_at: string | null;
  ticket_created_at: string | null;

  is_winner: boolean;

  raffle_item_name: string | null;

  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_county: string | null;
};

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const fetchPayments = async () => {
    try {
      setError(null);

      const { data, error } = await supabase
        .from("payments_view")
        .select(
          `
          ticket_id, raffle_id, customer_id,
          ticket_number, ticket_code,
          payment_status, payment_intent_id, checkout_session_id,
          payment_amount, payment_currency, payment_method,
          payment_completed_at, payment_error,
          purchased_at, ticket_created_at,
          is_winner,
          raffle_item_name,
          customer_name, customer_email, customer_phone, customer_county
        `
        )
        .order("ticket_created_at", { ascending: false });

      if (error) throw error;

      setRows((data ?? []) as PaymentViewRow[]);
    } catch (err: unknown) {
      console.error("Error loading payments:", err);
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await fetchPayments();
      setLoading(false);
    };
    run();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.payment_status !== statusFilter)
        return false;
      if (!q) return true;

      const haystack = [
        r.raffle_item_name,
        r.customer_name,
        r.customer_email,
        r.customer_phone,
        r.customer_county,
        r.ticket_code,
        r.payment_intent_id,
        r.checkout_session_id,
        r.ticket_id,
        r.raffle_id,
        r.customer_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [rows, statusFilter, query]);

  const summary = useMemo(() => {
    const completed = rows.filter((r) => r.payment_status === "completed");
    const pending = rows.filter((r) => r.payment_status === "pending");
    const failed = rows.filter((r) => r.payment_status === "failed");

    const revenue = completed.reduce(
      (acc, r) => acc + toNumber(r.payment_amount),
      0
    );

    const currency =
      rows.find((r) => (r.payment_currency || "").toLowerCase() === "eur")
        ?.payment_currency ||
      rows.find((r) => r.payment_currency)?.payment_currency ||
      "eur";

    return {
      total: rows.length,
      completed: completed.length,
      pending: pending.length,
      failed: failed.length,
      revenue,
      currency,
    };
  }, [rows]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchPayments();
    setRefreshing(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Payments
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Admin payments feed (tickets → payments_view). Search by raffle,
            customer, ticket code, intent/session.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="px-4 py-2 rounded-full text-sm font-medium"
          style={{
            backgroundColor: COLORS.secondaryButtonBg,
            color: COLORS.secondaryButtonText,
            opacity: loading || refreshing ? 0.6 : 1,
            boxShadow: `0 10px 24px ${COLORS.cardShadow}`,
          }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard label="Total records" value={summary.total.toString()} />
        <SummaryCard label="Completed" value={summary.completed.toString()} />
        <SummaryCard label="Pending" value={summary.pending.toString()} />
        <SummaryCard label="Failed" value={summary.failed.toString()} />
        <SummaryCard
          label="Revenue (completed)"
          value={formatMoney(summary.revenue, summary.currency)}
          emphasis
        />
      </div>

      {/* Controls */}
      <div
        className="rounded-2xl p-4 border space-y-3"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 14px 34px ${COLORS.cardShadow}`,
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <div className="flex flex-wrap gap-2">
            <StatusFilterButton
              label="All"
              value="all"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Completed"
              value="completed"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Pending"
              value="pending"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Failed"
              value="failed"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
          </div>

          <div className="w-full md:w-96">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search raffle, customer, ticket code, intent/session…"
              className="w-full border rounded-full px-4 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
          </div>
        </div>

        <div className="text-xs" style={{ color: COLORS.textMuted }}>
          Showing{" "}
          <span style={{ color: COLORS.textPrimary }}>{filtered.length}</span>{" "}
          of <span style={{ color: COLORS.textPrimary }}>{rows.length}</span>{" "}
          records
        </div>
      </div>

      {/* Error / Loading */}
      {error && (
        <div
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: "#FEF2F2",
            borderColor: "#FCA5A5",
            color: COLORS.error,
          }}
        >
          {error}
        </div>
      )}

      {loading && !error && (
        <div
          className="rounded-2xl px-4 py-3 text-sm border animate-pulse"
          style={{
            backgroundColor: COLORS.highlightCardBg,
            borderColor: COLORS.cardBorder,
            color: COLORS.textSecondary,
          }}
        >
          Loading payments...
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div
          className="rounded-2xl overflow-hidden border"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
          }}
        >
          {filtered.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div
                className="text-sm font-medium"
                style={{ color: COLORS.textPrimary }}
              >
                No payments found
              </div>
              <div className="text-xs" style={{ color: COLORS.textSecondary }}>
                Try switching filters or search terms.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead
                  style={{
                    backgroundColor: COLORS.highlightCardBg,
                    color: COLORS.textSecondary,
                  }}
                >
                  <tr>
                    <Th>Status</Th>
                    <Th>Amount</Th>
                    <Th>Raffle</Th>
                    <Th>Customer</Th>
                    <Th>Stripe</Th>
                    <Th>Completed</Th>
                    <Th>Created</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((r, index) => (
                    <tr
                      key={r.ticket_id}
                      className="border-t"
                      style={{
                        borderColor: COLORS.cardBorder,
                        backgroundColor:
                          index % 2 === 1 ? "#FAFAF9" : COLORS.cardBg,
                      }}
                    >
                      <td className="px-4 py-3 align-top">
                        <PaymentStatusBadge status={r.payment_status} />
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div style={{ color: COLORS.textPrimary }}>
                          {r.payment_amount != null
                            ? formatMoney(
                                toNumber(r.payment_amount),
                                r.payment_currency || "eur"
                              )
                            : "—"}
                        </div>
                        <div
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textMuted }}
                        >
                          Ticket #{r.ticket_number}
                          {r.ticket_code ? ` · Code: ${r.ticket_code}` : ""}
                          {r.is_winner ? " · Winner" : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        {r.raffle_id ? (
                          <Link
                            href={`/raffles/${r.raffle_id}`}
                            className="underline"
                            style={{ color: COLORS.primary }}
                          >
                            {r.raffle_item_name || r.raffle_id}
                          </Link>
                        ) : (
                          <span style={{ color: COLORS.textMuted }}>—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="space-y-0.5">
                          <div style={{ color: COLORS.textPrimary }}>
                            {r.customer_name || "—"}
                          </div>
                          <div
                            className="text-xs"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {r.customer_email || r.customer_id}
                          </div>
                          <div
                            className="text-[0.7rem]"
                            style={{ color: COLORS.textMuted }}
                          >
                            {r.customer_phone ? `${r.customer_phone} · ` : ""}
                            {r.customer_county || ""}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div
                          className="text-xs"
                          style={{ color: COLORS.textSecondary }}
                        >
                          {r.payment_intent_id || "—"}
                        </div>
                        <div
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textMuted }}
                        >
                          {r.checkout_session_id || ""}
                        </div>
                        <div
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textMuted }}
                        >
                          {r.payment_method
                            ? `Method: ${r.payment_method}`
                            : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className="text-xs"
                          style={{ color: COLORS.textSecondary }}
                        >
                          {r.payment_completed_at
                            ? new Date(r.payment_completed_at).toLocaleString(
                                "en-IE"
                              )
                            : "—"}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className="text-xs"
                          style={{ color: COLORS.textSecondary }}
                        >
                          {r.ticket_created_at
                            ? new Date(r.ticket_created_at).toLocaleString(
                                "en-IE"
                              )
                            : "—"}
                        </span>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <span
                          className="text-xs"
                          style={{
                            color: r.payment_error
                              ? COLORS.error
                              : COLORS.textMuted,
                          }}
                          title={r.payment_error || undefined}
                        >
                          {r.payment_error
                            ? truncate(r.payment_error, 80)
                            : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-4 border"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        boxShadow: `0 10px 24px ${COLORS.cardShadow}`,
      }}
    >
      <div
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: COLORS.textSecondary }}
      >
        {label}
      </div>
      <div
        className={
          emphasis ? "text-xl font-bold mt-1" : "text-lg font-semibold mt-1"
        }
        style={{ color: emphasis ? COLORS.primary : COLORS.textPrimary }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusFilterButton({
  label,
  value,
  activeValue,
  onClick,
}: {
  label: string;
  value: StatusFilter;
  activeValue: StatusFilter;
  onClick: (v: StatusFilter) => void;
}) {
  const isActive = value === activeValue;

  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className="px-3 py-1.5 rounded-full text-[0.75rem] font-medium border transition-colors"
      style={{
        backgroundColor: isActive ? COLORS.tabActiveBg : COLORS.tabBg,
        color: isActive ? COLORS.tabActiveTint : COLORS.tabInactiveTint,
        borderColor: COLORS.tabBorder,
      }}
    >
      {label}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wide">
      {children}
    </th>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  let bg = COLORS.info;
  let label = status;

  if (status === "completed") {
    bg = COLORS.success;
    label = "completed";
  } else if (status === "pending") {
    bg = COLORS.warning;
    label = "pending";
  } else if (status === "failed") {
    bg = COLORS.error;
    label = "failed";
  }

  return (
    <span
      className="text-xs font-semibold px-2 py-1 rounded-full"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
    >
      {label}
    </span>
  );
}

function toNumber(v: string | number | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

function formatMoney(amount: number, currency: string): string {
  const cur = (currency || "eur").toLowerCase();
  if (cur === "eur") return `€${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${cur.toUpperCase()}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
