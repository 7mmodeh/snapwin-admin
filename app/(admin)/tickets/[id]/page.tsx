// app/(admin)/tickets/[id]/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type PaymentStatus = "pending" | "completed" | "failed";

type OneOrMany<T> = T | T[] | null;

type TicketDetail = {
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
    ticket_price: number;
    status: string;
  } | null;
  customers?: { id: string; email: string; name?: string | null } | null;
};

type TicketDetailRaw = Omit<TicketDetail, "raffles" | "customers"> & {
  // With explicit FK pinning + aliasing, these come back as *single objects* (or null),
  // but we still accept OneOrMany for safety across environments.
  raffles?: OneOrMany<{
    id: string;
    item_name: string;
    ticket_price: number;
    status: string;
  }>;
  customers?: OneOrMany<{ id: string; email: string; name?: string | null }>;
};

function firstOrNull<T>(v: OneOrMany<T> | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
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

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const pe = err as Partial<PostgrestError>;
    if (typeof pe.message === "string" && pe.message.trim()) return pe.message;
  }
  return "Failed to load ticket.";
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

  // Throttle realtime bursts
  const rtTimerRef = useRef<number | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;

    try {
      setLoading(true);
      setError(null);

      // ✅ IMPORTANT: pin the FK relationships explicitly to avoid PGRST201 ambiguity
      // - tickets -> raffles can be ambiguous if raffles has winning_ticket_id etc.
      // - use FK names from Supabase hint:
      //   raffles!tickets_raffle_id_fkey
      //   customers!tickets_customer_id_fkey
      //
      // Keep the original property names (raffles/customers) so the rest of the file is unchanged.
      const { data, error: qErr } = await supabase
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
            raffles:raffles!tickets_raffle_id_fkey ( id, item_name, ticket_price, status ),
            customers:customers!tickets_customer_id_fkey ( id, email, name )
          `
        )
        .eq("id", ticketId)
        .maybeSingle()
        .returns<TicketDetailRaw>();

      if (qErr) throw qErr;
      if (!data) {
        setError("Ticket not found.");
        setTicket(null);
        return;
      }

      // Normalize amount (safety) + nested relations (object vs array)
      const normalized: TicketDetail = {
        ...data,
        payment_amount: toNumberOrNull(data.payment_amount),
        payment_currency: toStringOrNull(data.payment_currency),
        payment_method: toStringOrNull(data.payment_method),
        payment_intent_id: toStringOrNull(data.payment_intent_id),
        checkout_session_id: toStringOrNull(data.checkout_session_id),
        payment_completed_at: toStringOrNull(data.payment_completed_at),
        payment_error: toStringOrNull(data.payment_error),
        created_at: toStringOrNull(data.created_at),
        ticket_code: toStringOrNull(data.ticket_code),
        raffles: firstOrNull(data.raffles),
        customers: firstOrNull(data.customers),
      };

      setTicket(normalized);
    } catch (err: unknown) {
      console.error("Admin ticket detail fetch error:", err);
      setError(toErrorMessage(err));
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  // Optional realtime refresh: if the ticket changes, re-fetch
  useEffect(() => {
    if (!ticketId) return;

    const scheduleRefresh = () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      rtTimerRef.current = window.setTimeout(() => {
        fetchTicket();
      }, 250);
    };

    const channel: RealtimeChannel = supabase
      .channel(`admin_ticket_${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `id=eq.${ticketId}`,
        },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [ticketId, fetchTicket]);

  const statusBadge = useMemo(() => {
    const s = ticket?.payment_status;
    const label =
      s === "completed"
        ? "Completed"
        : s === "pending"
        ? "Pending"
        : s === "failed"
        ? "Failed"
        : (s as string) || "—";

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

  const customerDisplay =
    ticket.customers?.name?.trim() ||
    ticket.customers?.email?.trim() ||
    ticket.customer_id;

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
                {customerDisplay}
              </Link>
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                {ticket.customers?.email
                  ? `Email: ${ticket.customers.email}`
                  : `Customer ID: ${ticket.customer_id}`}
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
