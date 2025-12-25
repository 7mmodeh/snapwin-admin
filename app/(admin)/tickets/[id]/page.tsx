"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type TicketDetail = {
  id: string;
  raffle_id: string;
  customer_id: string;
  ticket_number: number;
  ticket_code: string | null;

  payment_status: string;
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
    ticket_price: number;
    status: string;
  } | null;
  customers?: { id: string; email: string } | null;
};

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

function kv(label: string, value: React.ReactNode) {
  return (
    <div className="space-y-1">
      <div className="text-xs" style={{ color: COLORS.textMuted }}>
        {label}
      </div>
      <div
        className="text-sm font-medium"
        style={{ color: COLORS.textPrimary }}
      >
        {value}
      </div>
    </div>
  );
}

export default function AdminTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = (params as { id?: string | string[] }).id;
  const ticketId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);

  const statusBadge = useMemo(() => {
    const s = ticket?.payment_status;
    const label =
      s === "completed"
        ? "Completed"
        : s === "pending"
        ? "Pending"
        : s === "failed"
        ? "Failed"
        : s || "—";
    const bg =
      s === "completed"
        ? "#ECFDF5"
        : s === "pending"
        ? "#FFFBEB"
        : s === "failed"
        ? "#FEF2F2"
        : COLORS.highlightCardBg;
    const border =
      s === "completed"
        ? "#6EE7B7"
        : s === "pending"
        ? "#FCD34D"
        : s === "failed"
        ? "#FCA5A5"
        : COLORS.cardBorder;
    const color = s === "failed" ? COLORS.error : COLORS.textPrimary;

    return { label, bg, border, color };
  }, [ticket?.payment_status]);

  useEffect(() => {
    const fetchTicket = async () => {
      if (!ticketId) return;

      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
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
            raffles ( id, item_name, ticket_price, status ),
            customers ( id, email )
          `
          )
          .eq("id", ticketId)
          .maybeSingle<TicketDetail>();

        if (error) throw error;
        if (!data) {
          setError("Ticket not found.");
          setTicket(null);
          return;
        }

        setTicket(data);
      } catch (err: unknown) {
        console.error("Admin ticket detail fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load ticket.");
        setTicket(null);
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [ticketId]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading ticket...
      </div>
    );
  }

  if (error && !ticket) {
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
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: "#FEF2F2",
            borderColor: "#FCA5A5",
            color: COLORS.error,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!ticket) return null;

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
            ← Back to tickets
          </button>

          <div className="flex items-center gap-3 flex-wrap">
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: COLORS.primary }}
            >
              Ticket #{ticket.ticket_number}
            </h1>

            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium"
              style={{
                backgroundColor: statusBadge.bg,
                borderColor: statusBadge.border,
                color: statusBadge.color,
              }}
            >
              {statusBadge.label}
            </span>

            {ticket.is_winner ? (
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium"
                style={{
                  backgroundColor: "#EEF2FF",
                  borderColor: "#A5B4FC",
                  color: COLORS.textPrimary,
                }}
              >
                WINNER
              </span>
            ) : null}
          </div>

          <p className="text-sm mt-1" style={{ color: COLORS.textSecondary }}>
            Full purchase record, references, and quick links to the related
            raffle and customer.
          </p>
        </div>
      </div>

      {/* Main card */}
      <div
        className="rounded-2xl p-5 border space-y-6"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {kv("Ticket ID", ticket.id)}
          {kv("Ticket code", ticket.ticket_code ?? "—")}
          {kv(
            "Created at",
            ticket.created_at
              ? new Date(ticket.created_at).toLocaleString("en-IE")
              : "—"
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {kv(
            "Raffle",
            <div className="space-y-1">
              <Link
                href={`/raffles/${ticket.raffle_id}`}
                className="underline"
                style={{ color: COLORS.primary }}
              >
                {ticket.raffles?.item_name ?? ticket.raffle_id}
              </Link>
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Status: {ticket.raffles?.status ?? "—"} • Ticket price:{" "}
                {ticket.raffles?.ticket_price != null
                  ? `€${ticket.raffles.ticket_price}`
                  : "—"}
              </div>
            </div>
          )}
          {kv(
            "Customer",
            <div className="space-y-1">
              <Link
                href={`/customers/${ticket.customer_id}`}
                className="underline"
                style={{ color: COLORS.primary }}
              >
                {ticket.customers?.email ?? ticket.customer_id}
              </Link>
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Customer ID: {ticket.customer_id}
              </div>
            </div>
          )}
          {kv(
            "Winner flag (ticket.is_winner)",
            ticket.is_winner ? "true" : "false"
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {kv(
            "Payment amount",
            formatMoney(ticket.payment_amount, ticket.payment_currency)
          )}
          {kv("Payment method", ticket.payment_method ?? "—")}
          {kv(
            "Completed at",
            ticket.payment_completed_at
              ? new Date(ticket.payment_completed_at).toLocaleString("en-IE")
              : "—"
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kv("Stripe payment_intent_id", ticket.payment_intent_id ?? "—")}
          {kv("Stripe checkout_session_id", ticket.checkout_session_id ?? "—")}
        </div>

        {ticket.payment_status === "failed" && ticket.payment_error ? (
          <div
            className="rounded-2xl px-4 py-3 text-sm border"
            style={{
              backgroundColor: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: COLORS.error,
            }}
          >
            <div className="font-semibold mb-1">Payment error</div>
            <div style={{ color: COLORS.textPrimary, whiteSpace: "pre-wrap" }}>
              {ticket.payment_error}
            </div>
          </div>
        ) : null}

        <div
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: COLORS.highlightCardBg,
            borderColor: COLORS.cardBorder,
            color: COLORS.textSecondary,
          }}
        >
          <div
            className="font-semibold mb-1"
            style={{ color: COLORS.textPrimary }}
          >
            Admin workflow hints
          </div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              If status is <b>pending</b> for too long, check the Stripe
              session/payment intent and your webhook/edge function flow.
            </li>
            <li>
              If status is <b>failed</b>, the error above is the first clue;
              also check Stripe dashboard logs.
            </li>
            <li>
              If the raffle is <b>drawn</b>, winning logic should align with{" "}
              <code>raffles.winning_ticket_id</code> and the trigger that
              updates <code>tickets.is_winner</code>.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
