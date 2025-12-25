// app/(admin)/customers/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type CustomerDetail = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  county: string;
  created_at: string;
  stripe_customer_id: string | null;
};

type PaymentStatus = "pending" | "completed" | "failed";

type CustomerTicket = {
  id: string;
  raffle_id: string;
  customer_id: string;
  ticket_number: number;
  ticket_code: string | null; // ✅ latest model
  payment_status: PaymentStatus | string; // ✅ tolerate legacy/unexpected values
  is_winner: boolean | null;
  purchased_at: string | null;
  payment_amount: number | null; // ✅ normalized
};

type CustomerDetailRaw = Record<string, unknown>;
type CustomerTicketRaw = Record<string, unknown>;

function toPostgrestError(err: unknown): PostgrestError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Partial<PostgrestError>;
  if (typeof e.message === "string") return e as PostgrestError;
  return null;
}

function toStringOrEmpty(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

function normalizeCustomer(raw: CustomerDetailRaw): CustomerDetail | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const email = typeof raw.email === "string" ? raw.email : null;
  const created_at = typeof raw.created_at === "string" ? raw.created_at : null;

  if (!id || !name || !email || !created_at) return null;

  return {
    id,
    name,
    email,
    phone: toStringOrEmpty(raw.phone),
    address: toStringOrEmpty(raw.address),
    county: toStringOrEmpty(raw.county),
    created_at,
    stripe_customer_id: toStringOrNull(raw.stripe_customer_id),
  };
}

function normalizeTicket(raw: CustomerTicketRaw): CustomerTicket | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const raffle_id = typeof raw.raffle_id === "string" ? raw.raffle_id : null;
  const customer_id =
    typeof raw.customer_id === "string" ? raw.customer_id : null;

  const ticket_number =
    typeof raw.ticket_number === "number"
      ? raw.ticket_number
      : parseInt(String(raw.ticket_number ?? ""), 10);

  if (!id || !raffle_id || !customer_id || !Number.isFinite(ticket_number)) {
    return null;
  }

  return {
    id,
    raffle_id,
    customer_id,
    ticket_number,
    ticket_code: raw.ticket_code == null ? null : String(raw.ticket_code),
    payment_status: toStringOrEmpty(raw.payment_status),
    is_winner:
      typeof raw.is_winner === "boolean"
        ? raw.is_winner
        : (raw.is_winner as boolean | null) ?? null,
    purchased_at: toStringOrNull(raw.purchased_at),
    payment_amount: toNumberOrNull(raw.payment_amount),
  };
}

function formatAmount(amount: number | null): string {
  if (amount == null || !Number.isFinite(amount)) return "-";
  return amount.toFixed(2);
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const customerId = params.id;

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Throttle realtime bursts
  const rtTimerRef = useRef<number | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      if (!customerId) return;

      setLoading(true);
      setError(null);

      const [customerRes, ticketsRes] = await Promise.all([
        supabase
          .from("customers")
          .select(
            "id, name, email, phone, address, county, created_at, stripe_customer_id"
          )
          .eq("id", customerId)
          .maybeSingle(),
        supabase
          .from("tickets")
          .select(
            "id, raffle_id, customer_id, ticket_number, ticket_code, payment_status, is_winner, purchased_at, payment_amount"
          )
          .eq("customer_id", customerId)
          .order("purchased_at", { ascending: false }),
      ]);

      if (customerRes.error) throw customerRes.error;
      if (!customerRes.data) {
        setCustomer(null);
        setTickets([]);
        setError("Customer not found.");
        return;
      }
      if (ticketsRes.error) throw ticketsRes.error;

      const custNorm = normalizeCustomer(
        (customerRes.data ?? {}) as CustomerDetailRaw
      );
      if (!custNorm) {
        setCustomer(null);
        setTickets([]);
        setError("Customer record is missing required fields.");
        return;
      }

      const rawList: unknown = ticketsRes.data ?? [];
      const list: unknown[] = Array.isArray(rawList) ? rawList : [];

      const normalizedTickets: CustomerTicket[] = [];
      for (const r of list) {
        const t = normalizeTicket((r ?? {}) as CustomerTicketRaw);
        if (t) normalizedTickets.push(t);
      }

      setCustomer(custNorm);
      setTickets(normalizedTickets);
    } catch (err: unknown) {
      console.error("Error loading customer:", err);
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error
            ? err.message
            : "Failed to load customer details.")
      );
      setCustomer(null);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Optional realtime refresh (keeps this page consistent with tickets/raffles pages)
  useEffect(() => {
    if (!customerId) return;

    const scheduleRefresh = () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      rtTimerRef.current = window.setTimeout(() => {
        fetchDetail();
      }, 250);
    };

    const channel: RealtimeChannel = supabase
      .channel(`admin-customer-${customerId}-tickets`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `customer_id=eq.${customerId}`,
        },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [customerId, fetchDetail]);

  const stats = useMemo(() => {
    if (!tickets.length) {
      return {
        totalTickets: 0,
        completedTickets: 0,
        failedTickets: 0,
        totalSpent: 0,
        wins: 0,
      };
    }

    let completedTickets = 0;
    let failedTickets = 0;
    let wins = 0;
    let totalSpent = 0;

    for (const t of tickets) {
      if (t.payment_status === "completed") {
        completedTickets += 1;
        if (t.payment_amount != null) totalSpent += t.payment_amount;
      } else if (t.payment_status === "failed") {
        failedTickets += 1;
      }

      if (t.is_winner) wins += 1;
    }

    return {
      totalTickets: tickets.length,
      completedTickets,
      failedTickets,
      totalSpent,
      wins,
    };
  }, [tickets]);

  // Export this customer's tickets as CSV
  const handleExportTickets = () => {
    if (!tickets.length || !customer) return;

    const header = [
      "ticket_code",
      "ticket_number",
      "payment_status",
      "is_winner",
      "purchased_at",
      "payment_amount",
      "raffle_id",
      "customer_id",
    ];

    const rows = tickets.map((t) => [
      t.ticket_code ?? "",
      t.ticket_number,
      t.payment_status,
      t.is_winner ? "true" : "false",
      t.purchased_at ? new Date(t.purchased_at).toISOString() : "",
      t.payment_amount ?? "",
      t.raffle_id,
      t.customer_id,
    ]);

    const csvContent =
      [header, ...rows]
        .map((row) =>
          row
            .map((value) => {
              const str = String(value ?? "");
              const escaped = str.replace(/"/g, '""');
              return `"${escaped}"`;
            })
            .join(",")
        )
        .join("\n") + "\n";

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = customer.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    link.href = url;
    link.download = `snapwin-customer-${safeName || customer.id}-tickets.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading customer...
      </div>
    );
  }

  if (error && !customer) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm underline"
          style={{ color: COLORS.primary }}
        >
          ← Back
        </button>
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm underline mb-2"
            style={{ color: COLORS.primary }}
          >
            ← Back to customers
          </button>
          <h1
            className="text-3xl font-bold mb-1"
            style={{ color: COLORS.primary }}
          >
            {customer.name}
          </h1>
          <p style={{ color: COLORS.textSecondary }}>{customer.email}</p>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <span className="text-xs" style={{ color: COLORS.textSecondary }}>
            Customer ID: {customer.id}
          </span>
          {customer.stripe_customer_id && (
            <span className="text-xs" style={{ color: COLORS.textSecondary }}>
              Stripe ID: {customer.stripe_customer_id}
            </span>
          )}

          {/* Export button */}
          <button
            type="button"
            onClick={handleExportTickets}
            disabled={!tickets.length}
            className="mt-2 px-3 py-2 rounded text-xs font-medium"
            style={{
              backgroundColor: COLORS.secondaryButtonBg,
              color: COLORS.secondaryButtonText,
              opacity: tickets.length ? 1 : 0.5,
            }}
          >
            Export tickets CSV
          </button>
        </div>
      </div>

      {/* Info + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Info card */}
        <div
          className="rounded-lg p-4 lg:col-span-2"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            borderWidth: 1,
          }}
        >
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: COLORS.textPrimary }}
          >
            Customer details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <DetailRow label="Name" value={customer.name} />
            <DetailRow label="Email" value={customer.email} />
            <DetailRow label="Phone" value={customer.phone || "-"} />
            <DetailRow label="County" value={customer.county || "-"} />
            <DetailRow label="Address" value={customer.address || "-"} />
            <DetailRow
              label="Joined"
              value={new Date(customer.created_at).toLocaleString("en-IE")}
            />
          </div>
        </div>

        {/* Stats card */}
        <div
          className="rounded-lg p-4 space-y-3"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            borderWidth: 1,
          }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            Activity
          </h2>

          <StatRow
            label="Total tickets"
            value={stats.totalTickets.toString()}
          />
          <StatRow
            label="Completed tickets"
            value={stats.completedTickets.toString()}
          />
          <StatRow
            label="Failed tickets"
            value={stats.failedTickets.toString()}
          />
          <StatRow label="Times won" value={stats.wins.toString()} />
          <StatRow
            label="Total spent"
            value={`€${stats.totalSpent.toFixed(2)}`}
          />
        </div>
      </div>

      {/* Tickets table */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          borderWidth: 1,
        }}
      >
        <div
          className="p-4 border-b"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            Tickets
          </h2>
          <p className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
            All tickets purchased by this customer.
          </p>
        </div>

        {tickets.length === 0 ? (
          <div className="p-4" style={{ color: COLORS.textMuted }}>
            This customer has no tickets yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead
                style={{
                  backgroundColor: COLORS.highlightCardBg,
                  color: COLORS.textSecondary,
                }}
              >
                <tr>
                  <th className="px-3 py-2 text-left">Ticket</th>
                  <th className="px-3 py-2 text-left">Payment status</th>
                  <th className="px-3 py-2 text-left">Winner</th>
                  <th className="px-3 py-2 text-left">Raffle ID</th>
                  <th className="px-3 py-2 text-left">Purchased at</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col">
                        <span style={{ color: COLORS.textPrimary }}>
                          #{t.ticket_number}
                        </span>
                        <span
                          style={{
                            color: COLORS.textMuted,
                            fontSize: "0.7rem",
                          }}
                        >
                          Code: {t.ticket_code ?? "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <TicketStatusBadge status={t.payment_status} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {t.is_winner ? (
                        <span
                          className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
                          style={{
                            backgroundColor: COLORS.success,
                            color: COLORS.textOnPrimary,
                          }}
                        >
                          Winner
                        </span>
                      ) : (
                        <span
                          style={{
                            color: COLORS.textMuted,
                            fontSize: "0.75rem",
                          }}
                        >
                          -
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        style={{
                          color: COLORS.textSecondary,
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.raffle_id}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        style={{
                          color: COLORS.textSecondary,
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.purchased_at
                          ? new Date(t.purchased_at).toLocaleString("en-IE")
                          : "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <span style={{ color: COLORS.textPrimary }}>
                        {t.payment_amount != null
                          ? `€${formatAmount(t.payment_amount)}`
                          : "-"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-[0.7rem] uppercase tracking-wide font-medium"
        style={{ color: COLORS.textMuted }}
      >
        {label}
      </div>
      <div className="text-sm" style={{ color: COLORS.textPrimary }}>
        {value}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span style={{ color: COLORS.textSecondary }}>{label}</span>
      <span style={{ color: COLORS.textPrimary }}>{value}</span>
    </div>
  );
}

function TicketStatusBadge({
  status,
}: {
  status: CustomerTicket["payment_status"];
}) {
  let bg = COLORS.info;
  let label: string = String(status ?? "");

  if (status === "completed") {
    bg = COLORS.success;
    label = "Completed";
  } else if (status === "pending") {
    bg = COLORS.warning;
    label = "Pending";
  } else if (status === "failed") {
    bg = COLORS.error;
    label = "Failed";
  }

  return (
    <span
      className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
    >
      {label}
    </span>
  );
}
