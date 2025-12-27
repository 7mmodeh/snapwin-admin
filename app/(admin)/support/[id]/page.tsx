// app/(admin)/support/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

/* ---------------------------
   TYPES
---------------------------- */
type SupportRequestDetail = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_county: string | null;
  topic: string | null;
  issue_type: string;
  raffle_id: string | null;
  raffle_item_name: string | null;
  ticket_id: string | null;
  ticket_number: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type SupportMessageRow = {
  id: string;
  sender_type: string;
  sender_email: string | null;
  sender_name: string | null;
  message: string;
  created_at: string;
};

const STATUS_OPTIONS = ["open", "pending", "closed"] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

// Typing broadcast payload (ephemeral)
type TypingPayload = {
  request_id: string;
  from: "customer" | "admin";
  isTyping: boolean;
  at: number;
};

// Local admin delivery state (optimistic)
type LocalDeliveryState = "sending" | "failed";
type LocalAdminMessage = {
  local_id: string;
  message: string;
  created_at: string;
  delivery: LocalDeliveryState;
};

// Combined message type for rendering (server + local)
type CombinedMessage =
  | {
      kind: "server";
      id: string;
      sender_type: string;
      sender_email: string | null;
      sender_name: string | null;
      message: string;
      created_at: string;
    }
  | {
      kind: "local";
      id: string;
      sender_type: "admin";
      sender_email: null;
      sender_name: "Admin";
      message: string;
      created_at: string;
      delivery: LocalDeliveryState;
    };

// Helpers to safely read unknown payloads
type DbRow = Record<string, unknown>;

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function asNullableString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return String(v);
}

function asNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function normalizeSupportMessageRow(input: unknown): SupportMessageRow | null {
  if (!input || typeof input !== "object") return null;
  const o = input as DbRow;

  const id = asString(o.id);
  if (!id) return null;

  return {
    id,
    sender_type: asString(o.sender_type),
    sender_email: asNullableString(o.sender_email),
    sender_name: asNullableString(o.sender_name),
    message: asString(o.message),
    created_at: asString(o.created_at) || new Date().toISOString(),
  };
}

function normalizeSupportRequestPatch(
  input: unknown
): Partial<SupportRequestDetail> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as DbRow;

  // require id to apply patch reliably
  const id = asNullableString(o.id);
  if (!id) return null;

  const patch: Partial<SupportRequestDetail> = { id };

  if ("customer_name" in o)
    patch.customer_name = asNullableString(o.customer_name);
  if ("customer_email" in o)
    patch.customer_email = asNullableString(o.customer_email);
  if ("customer_phone" in o)
    patch.customer_phone = asNullableString(o.customer_phone);
  if ("customer_county" in o)
    patch.customer_county = asNullableString(o.customer_county);
  if ("topic" in o) patch.topic = asNullableString(o.topic);
  if ("issue_type" in o) patch.issue_type = asString(o.issue_type);
  if ("raffle_id" in o) patch.raffle_id = asNullableString(o.raffle_id);
  if ("raffle_item_name" in o)
    patch.raffle_item_name = asNullableString(o.raffle_item_name);
  if ("ticket_id" in o) patch.ticket_id = asNullableString(o.ticket_id);
  if ("ticket_number" in o)
    patch.ticket_number = asNullableNumber(o.ticket_number);
  if ("status" in o) patch.status = asString(o.status);
  if ("created_at" in o) patch.created_at = asString(o.created_at);
  if ("updated_at" in o) patch.updated_at = asString(o.updated_at);

  return patch;
}

function makeLocalId() {
  const s = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `local:${s}`;
}

/* ---------------------------
   PAGE
---------------------------- */
export default function SupportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = params.id;

  const [request, setRequest] = useState<SupportRequestDetail | null>(null);
  const [messages, setMessages] = useState<SupportMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusDraft, setStatusDraft] = useState<StatusOption>("open");
  const [savingStatus, setSavingStatus] = useState(false);

  const [reply, setReply] = useState("");

  // Typing indicator state
  const [customerIsTyping, setCustomerIsTyping] = useState(false);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );

  const myStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOtherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delivery state
  const [localAdminMessages, setLocalAdminMessages] = useState<
    LocalAdminMessage[]
  >([]);
  const [sendingReply, setSendingReply] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  const isClosed = normStatus(request?.status) === "closed";
  const replyDisabledReason = isClosed
    ? "This support request is closed. Chat is disabled."
    : null;

  useEffect(() => {
    let mounted = true;

    const fetchDetail = async () => {
      try {
        if (!requestId) return;
        setLoading(true);
        setError(null);
        setSuccess(null);

        const [reqRes, msgsRes] = await Promise.all([
          supabase
            .from("support_requests")
            .select(
              "id, customer_name, customer_email, customer_phone, customer_county, topic, issue_type, raffle_id, raffle_item_name, ticket_id, ticket_number, status, created_at, updated_at"
            )
            .eq("id", requestId)
            .maybeSingle<SupportRequestDetail>(),
          supabase
            .from("support_messages")
            .select(
              "id, sender_type, sender_email, sender_name, message, created_at"
            )
            .eq("request_id", requestId)
            .order("created_at", { ascending: true }),
        ]);

        if (reqRes.error) throw reqRes.error;
        if (!reqRes.data) {
          if (!mounted) return;
          setError("Support request not found.");
          setLoading(false);
          return;
        }
        if (msgsRes.error) throw msgsRes.error;

        if (!mounted) return;

        setRequest(reqRes.data);
        setMessages((msgsRes.data ?? []) as SupportMessageRow[]);

        const lowerStatus = normStatus(reqRes.data.status);
        if (STATUS_OPTIONS.includes(lowerStatus as StatusOption)) {
          setStatusDraft(lowerStatus as StatusOption);
        } else {
          setStatusDraft("open");
        }

        if (lowerStatus === "closed") {
          setReply("");
          setLocalAdminMessages([]);
          setCustomerIsTyping(false);
        }

        requestAnimationFrame(() => scrollToBottom(false));
      } catch (err: unknown) {
        console.error("Error loading support request:", err);
        if (!mounted) return;
        if (err instanceof Error) setError(err.message);
        else setError("Failed to load support request.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchDetail();
    return () => {
      mounted = false;
    };
  }, [requestId]);

  // ✅ Realtime: new messages in this request
  useEffect(() => {
    if (!requestId) return;

    const channel = supabase
      .channel(`rt-admin-support-messages-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          const row = normalizeSupportMessageRow(payload.new);
          if (!row) return;

          setMessages((prev) => {
            const next = [...prev, row];
            const seen = new Set<string>();
            return next.filter((m) => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
          });

          // if server message matches a local optimistic bubble, remove it
          setLocalAdminMessages((prev) => {
            if (!prev.length) return prev;
            const next = prev.filter((lm) => {
              const matchBody =
                (row.message || "").trim() === (lm.message || "").trim();
              if (!matchBody) return true;

              const tServer = new Date(row.created_at || Date.now()).getTime();
              const tLocal = new Date(lm.created_at).getTime();
              return Math.abs(tServer - tLocal) > 5000;
            });
            return next;
          });

          requestAnimationFrame(() => scrollToBottom(true));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId]);

  // ✅ Realtime: request updates (status, etc.)
  useEffect(() => {
    if (!requestId) return;

    const channel = supabase
      .channel(`rt-admin-support-request-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_requests",
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          const patch = normalizeSupportRequestPatch(payload.new);
          if (!patch) return;

          setRequest((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...patch };

            if (normStatus(next.status) === "closed") {
              setReply("");
              setLocalAdminMessages([]);
              setCustomerIsTyping(false);

              if (myStopTimerRef.current) {
                clearTimeout(myStopTimerRef.current);
                myStopTimerRef.current = null;
              }

              try {
                const ch = typingChannelRef.current;
                if (ch) {
                  ch.send({
                    type: "broadcast",
                    event: "typing",
                    payload: {
                      request_id: requestId,
                      from: "admin",
                      isTyping: false,
                      at: Date.now(),
                    } satisfies TypingPayload,
                  });
                }
              } catch {
                // no-op
              }
            }

            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId]);

  // ✅ Typing indicator channel (broadcast)
  useEffect(() => {
    if (!requestId) return;

    setCustomerIsTyping(false);

    if (myStopTimerRef.current) {
      clearTimeout(myStopTimerRef.current);
      myStopTimerRef.current = null;
    }
    if (clearOtherTimerRef.current) {
      clearTimeout(clearOtherTimerRef.current);
      clearOtherTimerRef.current = null;
    }

    const channel = supabase.channel(`typing-support:${requestId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as unknown;

      if (!p || typeof p !== "object") return;
      const o = p as Record<string, unknown>;

      const rid = asString(o.request_id);
      const from = asString(o.from);
      const isTyping = Boolean(o.isTyping);

      if (rid !== requestId) return;
      if (from !== "customer") return;
      if (normStatus(request?.status) === "closed") return;

      if (isTyping) {
        setCustomerIsTyping(true);
        if (clearOtherTimerRef.current)
          clearTimeout(clearOtherTimerRef.current);
        clearOtherTimerRef.current = setTimeout(() => {
          setCustomerIsTyping(false);
        }, 2000);
      } else {
        setCustomerIsTyping(false);
      }
    });

    channel.subscribe();
    typingChannelRef.current = channel;

    return () => {
      try {
        channel.send({
          type: "broadcast",
          event: "typing",
          payload: {
            request_id: requestId,
            from: "admin",
            isTyping: false,
            at: Date.now(),
          } satisfies TypingPayload,
        });
      } catch {
        // no-op
      }

      if (myStopTimerRef.current) {
        clearTimeout(myStopTimerRef.current);
        myStopTimerRef.current = null;
      }
      if (clearOtherTimerRef.current) {
        clearTimeout(clearOtherTimerRef.current);
        clearOtherTimerRef.current = null;
      }

      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setCustomerIsTyping(false);
    };
  }, [requestId, request?.status]);

  const emitAdminTyping = (isTyping: boolean) => {
    const ch = typingChannelRef.current;
    if (!ch || !requestId) return;
    if (normStatus(request?.status) === "closed") return;

    ch.send({
      type: "broadcast",
      event: "typing",
      payload: {
        request_id: requestId,
        from: "admin",
        isTyping,
        at: Date.now(),
      } satisfies TypingPayload,
    });
  };

  const onReplyChanged = (val: string) => {
    if (isClosed) {
      setReply("");
      return;
    }

    setReply(val);

    const hasText = !!val.trim();
    if (!hasText) {
      if (myStopTimerRef.current) {
        clearTimeout(myStopTimerRef.current);
        myStopTimerRef.current = null;
      }
      emitAdminTyping(false);
      return;
    }

    emitAdminTyping(true);

    if (myStopTimerRef.current) clearTimeout(myStopTimerRef.current);
    myStopTimerRef.current = setTimeout(() => {
      emitAdminTyping(false);
    }, 1400);
  };

  const stopTypingNow = () => {
    if (myStopTimerRef.current) {
      clearTimeout(myStopTimerRef.current);
      myStopTimerRef.current = null;
    }
    emitAdminTyping(false);
  };

  const handleSaveStatus = async () => {
    if (!request) return;

    try {
      setSavingStatus(true);
      setError(null);
      setSuccess(null);

      const nextStatus = statusDraft;

      const { error: updateError } = await supabase
        .from("support_requests")
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);

      if (updateError) throw updateError;

      setRequest((prev) =>
        prev
          ? {
              ...prev,
              status: nextStatus,
              updated_at: new Date().toISOString(),
            }
          : prev
      );

      if (nextStatus === "closed") {
        stopTypingNow();
        setReply("");
        setLocalAdminMessages([]);
        setCustomerIsTyping(false);
      }

      setSuccess("Status updated successfully.");
    } catch (err: unknown) {
      console.error("Error updating status:", err);
      if (err instanceof Error) setError(err.message);
      else setError("Failed to update status.");
    } finally {
      setSavingStatus(false);
    }
  };

  const insertAdminReply = async (text: string) => {
    if (!request) throw new Error("No request loaded.");
    if (normStatus(request.status) === "closed") {
      throw new Error("This support request is closed. Replies are disabled.");
    }

    const trimmed = text.trim();
    if (!trimmed) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const senderEmail = user?.email ?? null;

    const { data, error: insertError } = await supabase
      .from("support_messages")
      .insert({
        request_id: request.id,
        sender_type: "admin",
        sender_email: senderEmail,
        sender_name: "Admin",
        message: trimmed,
      })
      .select("id, sender_type, sender_email, sender_name, message, created_at")
      .single<SupportMessageRow>();

    if (insertError) throw insertError;
    return data;
  };

  const handleSendReply = async () => {
    if (!request) return;

    if (normStatus(request.status) === "closed") {
      setError("This support request is closed. Chat is disabled.");
      setReply("");
      return;
    }

    const text = reply.trim();
    if (!text) return;

    try {
      setSendingReply(true);
      setError(null);
      setSuccess(null);
      stopTypingNow();

      const localId = makeLocalId();
      const optimistic: LocalAdminMessage = {
        local_id: localId,
        message: text,
        created_at: new Date().toISOString(),
        delivery: "sending",
      };

      setLocalAdminMessages((prev) => [...prev, optimistic]);
      setReply("");

      requestAnimationFrame(() => scrollToBottom(true));

      await insertAdminReply(text);

      setLocalAdminMessages((prev) =>
        prev.filter((m) => m.local_id !== localId)
      );
      setSuccess("Reply sent.");
    } catch (err: unknown) {
      console.error("Error sending reply:", err);
      setLocalAdminMessages((prev) =>
        prev.map((m) =>
          m.delivery === "sending" ? { ...m, delivery: "failed" } : m
        )
      );

      if (err instanceof Error) setError(err.message);
      else setError("Failed to send reply.");
    } finally {
      setSendingReply(false);
    }
  };

  const retryLocal = async (local_id: string) => {
    if (normStatus(request?.status) === "closed") {
      setError("This support request is closed. Chat is disabled.");
      setLocalAdminMessages([]);
      return;
    }

    const lm = localAdminMessages.find((m) => m.local_id === local_id);
    if (!lm) return;

    try {
      setError(null);
      setSuccess(null);

      setLocalAdminMessages((prev) =>
        prev.map((m) =>
          m.local_id === local_id ? { ...m, delivery: "sending" } : m
        )
      );

      await insertAdminReply(lm.message);

      setLocalAdminMessages((prev) =>
        prev.filter((m) => m.local_id !== local_id)
      );
      setSuccess("Reply sent.");
    } catch (err: unknown) {
      console.error("Retry failed:", err);
      setLocalAdminMessages((prev) =>
        prev.map((m) =>
          m.local_id === local_id ? { ...m, delivery: "failed" } : m
        )
      );

      if (err instanceof Error) setError(err.message);
      else setError("Failed to send reply.");
    }
  };

  // ✅ Hooks must always run: compute memoized values before early returns
  const customerName =
    request?.customer_name || request?.customer_email || "Unknown customer";

  const combinedMessages: CombinedMessage[] = useMemo(() => {
    const server: CombinedMessage[] = (messages ?? []).map((m) => ({
      kind: "server",
      id: m.id,
      sender_type: m.sender_type,
      sender_email: m.sender_email,
      sender_name: m.sender_name,
      message: m.message,
      created_at: m.created_at,
    }));

    const locals: CombinedMessage[] =
      normStatus(request?.status) === "closed"
        ? []
        : (localAdminMessages ?? []).map((m) => ({
            kind: "local",
            id: m.local_id,
            sender_type: "admin",
            sender_email: null,
            sender_name: "Admin",
            message: m.message,
            created_at: m.created_at,
            delivery: m.delivery,
          }));

    return [...server, ...locals].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messages, localAdminMessages, request?.status]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading support request...
      </div>
    );
  }

  if (error && !request) {
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

  if (!request) return null;

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
            ← Back to support
          </button>
          <h1
            className="text-2xl font-bold mb-1"
            style={{ color: COLORS.primary }}
          >
            Support request
          </h1>
          <p style={{ color: COLORS.textSecondary }}>
            {customerName} · {request.issue_type}
          </p>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <StatusBadge status={request.status} />
          <span className="text-xs" style={{ color: COLORS.textSecondary }}>
            Request ID: {request.id}
          </span>
        </div>
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEF3C7", color: COLORS.textPrimary }}
        >
          <b>Closed:</b> This support request is closed. The chat thread is
          locked and no more replies can be sent.
        </div>
      )}

      {/* Alerts */}
      {success && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#DCFCE7", color: COLORS.success }}
        >
          {success}
        </div>
      )}
      {error && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      )}

      {/* Info + Status control */}
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
            Request details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <DetailRow label="Customer" value={customerName} />
            <DetailRow label="Email" value={request.customer_email || "—"} />
            <DetailRow label="Phone" value={request.customer_phone || "—"} />
            <DetailRow label="County" value={request.customer_county || "—"} />
            <DetailRow label="Issue type" value={request.issue_type} />
            <DetailRow label="Topic" value={request.topic || "—"} />
            <DetailRow
              label="Raffle"
              value={request.raffle_item_name || "No raffle linked"}
            />
            <DetailRow
              label="Ticket"
              value={
                request.ticket_number != null
                  ? `Ticket #${request.ticket_number}`
                  : "No ticket linked"
              }
            />
            <DetailRow
              label="Created"
              value={new Date(request.created_at).toLocaleString("en-IE")}
            />
            <DetailRow
              label="Last updated"
              value={new Date(request.updated_at).toLocaleString("en-IE")}
            />
          </div>
        </div>

        {/* Status control */}
        <div
          className="rounded-lg p-4 space-y-4"
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
            Status
          </h2>

          <div className="space-y-1">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Current status
            </label>
            <select
              value={statusDraft}
              onChange={(e) => setStatusDraft(e.target.value as StatusOption)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "open"
                    ? "Open"
                    : s === "pending"
                    ? "Pending"
                    : "Closed"}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSaveStatus}
            disabled={savingStatus}
            className="w-full rounded py-2 text-sm font-medium"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: savingStatus ? 0.7 : 1,
            }}
          >
            {savingStatus ? "Saving..." : "Save status"}
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div
        className="rounded-lg p-4 space-y-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          borderWidth: 1,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            className="text-lg font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            Conversation
          </h2>

          {!isClosed && customerIsTyping && (
            <div
              className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{
                backgroundColor: COLORS.highlightCardBg,
                color: COLORS.textSecondary,
              }}
            >
              Customer is typing…
            </div>
          )}
        </div>

        {combinedMessages.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.textMuted }}>
            No messages yet. You can send the first reply below.
          </p>
        ) : (
          <div
            ref={scrollRef}
            className="space-y-3 max-h-[420px] overflow-y-auto pr-1"
          >
            {combinedMessages.map((msg) => (
              <MessageBubble
                key={`${msg.kind}:${msg.id}`}
                msg={msg}
                onRetry={
                  msg.kind === "local" && msg.delivery === "failed"
                    ? () => retryLocal(msg.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Reply box */}
        <div
          className="border-t pt-3"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <label
            className="text-sm font-medium mb-1 block"
            style={{ color: COLORS.textSecondary }}
          >
            Your reply
          </label>

          <textarea
            value={reply}
            onChange={(e) => onReplyChanged(e.target.value)}
            rows={3}
            disabled={isClosed || sendingReply}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{
              borderColor: COLORS.inputBorder,
              backgroundColor: isClosed
                ? COLORS.highlightCardBg
                : COLORS.inputBg,
              color: COLORS.textPrimary,
              opacity: isClosed ? 0.7 : 1,
              cursor: isClosed ? "not-allowed" : "text",
            }}
            placeholder={
              replyDisabledReason ?? "Type your reply to the customer..."
            }
          />

          <div className="flex items-center justify-between mt-2">
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              {isClosed
                ? "Chat is locked (closed)."
                : sendingReply
                ? "Sending…"
                : " "}
            </div>

            <button
              type="button"
              onClick={handleSendReply}
              disabled={isClosed || sendingReply || !reply.trim()}
              className="px-4 py-2 rounded text-sm font-medium"
              style={{
                backgroundColor: COLORS.primaryButtonBg,
                color: COLORS.primaryButtonText,
                opacity: isClosed || sendingReply || !reply.trim() ? 0.5 : 1,
                cursor: isClosed ? "not-allowed" : "pointer",
              }}
              title={replyDisabledReason ?? undefined}
            >
              {sendingReply ? "Sending..." : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   UI COMPONENTS
---------------------------- */
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

function StatusBadge({ status }: { status: string }) {
  const lower = normStatus(status);
  let bg = COLORS.info;
  let label = status || "—";

  if (lower === "open") {
    bg = COLORS.warning;
    label = "Open";
  } else if (
    lower === "pending" ||
    lower === "in_progress" ||
    lower === "waiting_customer"
  ) {
    bg = COLORS.info;
    label = "Pending";
  } else if (lower === "closed") {
    bg = COLORS.success;
    label = "Closed";
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

function MessageBubble({
  msg,
  onRetry,
}: {
  msg: CombinedMessage;
  onRetry?: () => void;
}) {
  const isAdmin = normStatus(msg.sender_type) === "admin";
  const alignClass = isAdmin ? "items-end text-right" : "items-start text-left";

  const bubbleStyle = isAdmin
    ? {
        backgroundColor: COLORS.primary,
        color: COLORS.textOnPrimary,
        borderRadius: "16px",
        borderBottomRightRadius: "4px",
      }
    : {
        backgroundColor: COLORS.highlightCardBg,
        color: COLORS.textPrimary,
        borderRadius: "16px",
        borderBottomLeftRadius: "4px",
      };

  const name =
    msg.kind === "local"
      ? "Admin"
      : msg.sender_name || (isAdmin ? "Admin" : msg.sender_email || "Customer");

  return (
    <div className={`flex flex-col ${alignClass} gap-1`}>
      <div className="text-[0.7rem]" style={{ color: COLORS.textSecondary }}>
        {name} · {new Date(msg.created_at).toLocaleString("en-IE")}
        {msg.kind === "local" && msg.delivery === "sending" && (
          <span style={{ marginLeft: 8, color: COLORS.textMuted }}>
            • Sending…
          </span>
        )}
        {msg.kind === "local" && msg.delivery === "failed" && (
          <span style={{ marginLeft: 8, color: COLORS.error }}>• Failed</span>
        )}
      </div>

      <div
        className="inline-block px-3 py-2 max-w-[80%] text-sm"
        style={bubbleStyle}
      >
        {msg.message}
      </div>

      {msg.kind === "local" && msg.delivery === "failed" && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs underline"
          style={{ color: COLORS.error }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
