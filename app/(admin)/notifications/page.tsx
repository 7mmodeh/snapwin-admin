// app/(admin)/notifications/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type NotificationRow = {
  id: string;
  customer_id: string | null;
  raffle_id: string | null;
  type: string;
  audience: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

type AudienceFilter = "all" | "customer" | "admin";
type ReadFilter = "all" | "unread" | "read";
type TypeFilter = "all" | "payment" | "support" | "raffle" | "system" | "other";

/**
 * Raw shape from Supabase (unknown-safe).
 * We normalize with runtime guards to avoid casts.
 */
type NotificationRowRaw = {
  id?: unknown;
  customer_id?: unknown;
  raffle_id?: unknown;
  type?: unknown;
  audience?: unknown;
  title?: unknown;
  body?: unknown;
  is_read?: unknown;
  created_at?: unknown;
  read_at?: unknown;
};

const NOTIFICATIONS_SELECT =
  "id, customer_id, raffle_id, type, audience, title, body, is_read, created_at, read_at";

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

function toStringOrEmpty(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function toBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "f" || s === "0" || s === "no") return false;
  }
  return false;
}

function safeLower(x: string | null | undefined) {
  return (x ?? "").toLowerCase().trim();
}

function isoNow() {
  return new Date().toISOString();
}

function relativeTime(iso: string) {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - ts);

  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (day >= 7) {
    return new Date(iso).toLocaleDateString("en-IE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  if (day >= 2) return `${day} days ago`;
  if (day === 1) return "Yesterday";
  if (hr >= 2) return `${hr}h ago`;
  if (hr === 1) return "1h ago";
  if (min >= 2) return `${min}m ago`;
  if (min === 1) return "1m ago";
  if (sec >= 10) return `${sec}s ago`;
  return "Just now";
}

function dayBucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const ts = d.getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfYesterday) return "Yesterday";
  return "Earlier";
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard?.writeText(text);
  } catch {
    // ignore
  }
}

/**
 * Tiny runtime normalization:
 * - Ensures required fields exist
 * - Coerces audience/type/title/body to strings
 * - Coerces is_read to boolean
 * - Normalizes created_at/read_at/customer_id/raffle_id
 */
function normalizeNotificationRow(
  raw: NotificationRowRaw
): NotificationRow | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const created_at = typeof raw.created_at === "string" ? raw.created_at : null;

  const title = toStringOrEmpty(raw.title).trim();
  const body = toStringOrEmpty(raw.body).trim();

  if (!id || !created_at || !title) return null;

  const customer_id = toStringOrNull(raw.customer_id);
  const raffle_id = toStringOrNull(raw.raffle_id);
  const read_at = toStringOrNull(raw.read_at);

  const audience = toStringOrEmpty(raw.audience).trim() || "customer";
  const type = toStringOrEmpty(raw.type).trim() || "system";

  return {
    id,
    customer_id,
    raffle_id,
    type,
    audience,
    title,
    body,
    is_read: toBoolean(raw.is_read),
    created_at,
    read_at,
  };
}

function mergeById<T extends { id: string }>(prev: T[], next: T): T[] {
  const idx = prev.findIndex((x) => x.id === next.id);
  if (idx === -1) return [next, ...prev];
  const clone = prev.slice();
  clone[idx] = next;
  return clone;
}

function typeBucket(type: string): TypeFilter {
  const t = safeLower(type);
  if (!t) return "other";
  if (
    t.includes("payment") ||
    t.includes("stripe") ||
    t.includes("checkout") ||
    t.includes("ticket")
  )
    return "payment";
  if (t.includes("support")) return "support";
  if (t.includes("raffle") || t.includes("draw") || t.includes("winner"))
    return "raffle";
  if (t.includes("system") || t.includes("admin") || t.includes("security"))
    return "system";
  return "other";
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("unread");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");

  // Bulk selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newAudience, setNewAudience] = useState<"customer" | "admin">(
    "customer"
  );
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const setBusy = (id: string, v: boolean) =>
    setBusyIds((p) => ({ ...p, [id]: v }));

  useEffect(() => {
    mountedRef.current = true;

    const fetchNotifications = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await supabase
          .from("notifications")
          .select(NOTIFICATIONS_SELECT)
          .order("created_at", { ascending: false })
          .limit(300);

        const qErr: PostgrestError | null =
          (res as { error: PostgrestError | null }).error ?? null;
        const dataUnknown: unknown = (res as { data: unknown }).data ?? null;

        if (qErr) throw qErr;

        const rawList: NotificationRowRaw[] = Array.isArray(dataUnknown)
          ? (dataUnknown as NotificationRowRaw[])
          : [];

        const normalized: NotificationRow[] = [];
        for (const r of rawList) {
          const n = normalizeNotificationRow(r);
          if (n) normalized.push(n);
        }

        if (!mountedRef.current) return;
        setNotifications(normalized);
      } catch (err: unknown) {
        console.error("Error loading notifications:", err);
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load notifications."
        );
        setNotifications([]);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchNotifications();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Realtime: new notifications + read-state changes should show immediately
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifications-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          const raw = payload.new as NotificationRowRaw | null;
          if (!raw) return;

          const n = normalizeNotificationRow(raw);
          if (!n) return;

          setNotifications((prev) => {
            const merged = mergeById(prev, n);
            return merged.sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            );
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const filtered = useMemo(() => {
    let result = [...notifications];

    if (audienceFilter !== "all") {
      const af = audienceFilter.toLowerCase();
      result = result.filter((n) => safeLower(n.audience) === af);
    }

    if (readFilter === "unread") result = result.filter((n) => !n.is_read);
    if (readFilter === "read") result = result.filter((n) => n.is_read);

    if (typeFilter !== "all") {
      result = result.filter((n) => typeBucket(n.type) === typeFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((n) => {
        return (
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          (n.customer_id ?? "").toLowerCase().includes(q) ||
          (n.raffle_id ?? "").toLowerCase().includes(q) ||
          (n.type ?? "").toLowerCase().includes(q) ||
          (n.audience ?? "").toLowerCase().includes(q)
        );
      });
    }

    return result;
  }, [notifications, audienceFilter, readFilter, typeFilter, search]);

  const grouped = useMemo(() => {
    const g: Record<"Today" | "Yesterday" | "Earlier", NotificationRow[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };

    for (const n of filtered) {
      g[dayBucket(n.created_at)].push(n);
    }
    return g;
  }, [filtered]);

  const selectedIds = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [selected]
  );

  const anySelected = useMemo(() => selectedIds.length > 0, [selectedIds]);

  const toggleOne = (id: string) =>
    setSelected((p) => ({ ...p, [id]: !p[id] }));

  const toggleSelectVisible = () => {
    const visible = filtered.map((n) => n.id);
    const allSelected =
      visible.length > 0 && visible.every((id) => selected[id]);

    setSelected((prev) => {
      const next = { ...prev };
      for (const id of visible) next[id] = !allSelected;
      return next;
    });
  };

  const updateReadState = async (id: string, read: boolean) => {
    try {
      setBusy(id, true);

      const readAt = read ? isoNow() : null;

      // Optimistic
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, is_read: read, read_at: readAt } : n
        )
      );

      const res = await supabase
        .from("notifications")
        .update({ is_read: read, read_at: readAt })
        .eq("id", id)
        .select(NOTIFICATIONS_SELECT)
        .single();

      const qErr: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;

      if (qErr) throw qErr;
    } catch (err) {
      console.error("Failed to update notification:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update notification."
      );
    } finally {
      setBusy(id, false);
    }
  };

  const bulkMark = async (read: boolean) => {
    const ids = selectedIds;
    if (ids.length === 0) return;

    try {
      setBulkBusy(true);
      const readAt = read ? isoNow() : null;

      // Optimistic
      setNotifications((prev) =>
        prev.map((n) =>
          ids.includes(n.id) ? { ...n, is_read: read, read_at: readAt } : n
        )
      );

      const res = await supabase
        .from("notifications")
        .update({ is_read: read, read_at: readAt })
        .in("id", ids);

      const qErr: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;

      if (qErr) throw qErr;

      setSelected({});
    } catch (err) {
      console.error("Failed bulk update:", err);
      setError(err instanceof Error ? err.message : "Failed bulk update.");
    } finally {
      setBulkBusy(false);
    }
  };

  const markAllUnreadAsRead = async () => {
    const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;

    try {
      setBulkBusy(true);
      const readAt = isoNow();

      // Optimistic
      setNotifications((prev) =>
        prev.map((n) =>
          !n.is_read ? { ...n, is_read: true, read_at: readAt } : n
        )
      );

      const res = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: readAt })
        .in("id", ids);

      const qErr: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;

      if (qErr) throw qErr;
    } catch (err) {
      console.error("Failed mark all:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to mark all unread as read."
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const handleCreate = async () => {
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body) return;

    try {
      setCreating(true);
      setCreateError(null);
      setCreateSuccess(null);

      const payload = {
        title,
        body,
        audience: newAudience, // matches enum values
        type: "system",
        customer_id: targetCustomerId.trim() || null,
        raffle_id: null,
        is_read: false,
        read_at: null,
      };

      const res = await supabase
        .from("notifications")
        .insert(payload)
        .select(NOTIFICATIONS_SELECT)
        .single();

      const qErr: PostgrestError | null =
        (res as { error: PostgrestError | null }).error ?? null;
      const dataUnknown: unknown = (res as { data: unknown }).data ?? null;

      if (qErr) throw qErr;

      const created = normalizeNotificationRow(
        dataUnknown as NotificationRowRaw
      );
      if (!created)
        throw new Error("Notification created but could not be normalized.");

      setNotifications((prev) => [created, ...prev]);
      setNewTitle("");
      setNewBody("");
      setTargetCustomerId("");
      setNewAudience("customer");
      setCreateSuccess("Notification created successfully.");
    } catch (err: unknown) {
      console.error("Error creating notification:", err);
      setCreateError(
        err instanceof Error ? err.message : "Failed to create notification."
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1
            className="text-3xl font-bold mb-1"
            style={{ color: COLORS.primary }}
          >
            Notifications
          </h1>
          <p style={{ color: COLORS.textSecondary }}>
            Admin inbox. Unread:{" "}
            <span style={{ color: COLORS.primary, fontWeight: 800 }}>
              {unreadCount}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={markAllUnreadAsRead}
            disabled={bulkBusy || unreadCount === 0}
            className="px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-50"
            style={{
              backgroundColor: COLORS.tabBg,
              color: COLORS.textPrimary,
              borderColor: COLORS.cardBorder,
            }}
          >
            Mark all as read
          </button>

          {/* Search */}
          <div className="w-full md:w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title/body/type/IDs..."
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
          </div>
        </div>
      </div>

      {/* Create notification card */}
      <div
        className="rounded-2xl p-4 space-y-3 border"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Create notification
            </h2>
            <p className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>
              Send a system message to customers or admins. Optionally target a
              single customer_id.
            </p>
          </div>

          <div className="text-xs" style={{ color: COLORS.textMuted }}>
            Preview shows how it will appear in the inbox.
          </div>
        </div>

        {createError && (
          <div
            className="rounded px-3 py-2 text-xs"
            style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
          >
            {createError}
          </div>
        )}
        {createSuccess && (
          <div
            className="rounded px-3 py-2 text-xs"
            style={{ backgroundColor: "#DCFCE7", color: COLORS.success }}
          >
            {createSuccess}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Form */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="space-y-1 md:col-span-2">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="e.g. New raffle is live!"
                />
              </div>

              <div className="space-y-1">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Audience
                </label>
                <select
                  value={newAudience}
                  onChange={(e) =>
                    setNewAudience(e.target.value as "customer" | "admin")
                  }
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                >
                  <option value="customer">Customers</option>
                  <option value="admin">Admins</option>
                </select>
              </div>

              <div className="space-y-1">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Type
                </label>
                <input
                  type="text"
                  value={"system"}
                  disabled
                  className="w-full border rounded px-3 py-2 text-sm opacity-80"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Message
                </label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={4}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="Write the notification body..."
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Target customer (optional)
                </label>
                <input
                  type="text"
                  value={targetCustomerId}
                  onChange={(e) => setTargetCustomerId(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="Customer ID for a specific user, or leave empty for general notification"
                />
                <p className="text-xs" style={{ color: COLORS.textMuted }}>
                  Leave empty to create a general notification (no specific
                  customer_id).
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newTitle.trim() || !newBody.trim()}
                className="px-4 py-2 rounded text-sm font-medium"
                style={{
                  backgroundColor: COLORS.primaryButtonBg,
                  color: COLORS.primaryButtonText,
                  opacity:
                    creating || !newTitle.trim() || !newBody.trim() ? 0.7 : 1,
                }}
              >
                {creating ? "Sending..." : "Send notification"}
              </button>
            </div>
          </div>

          {/* Preview */}
          <div
            className="rounded-2xl border p-4"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.highlightCardBg,
            }}
          >
            <div
              className="text-xs font-semibold"
              style={{ color: COLORS.textSecondary }}
            >
              Preview
            </div>

            <div
              className="mt-3 rounded-2xl border p-4"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.cardBg,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Pill
                      label={newAudience === "admin" ? "Admin" : "Customer"}
                      kind={newAudience}
                    />
                    <span
                      className="text-sm font-semibold truncate"
                      style={{ color: COLORS.textPrimary }}
                    >
                      {newTitle.trim() || "Notification title"}
                    </span>
                    <span
                      className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: COLORS.primary,
                        color: COLORS.textOnPrimary,
                      }}
                    >
                      New
                    </span>
                  </div>

                  <div
                    className="text-xs mt-1"
                    style={{ color: COLORS.textSecondary }}
                  >
                    {newBody.trim()
                      ? truncate(newBody.trim(), 160)
                      : "Message preview will appear here."}
                  </div>

                  <div
                    className="text-[0.7rem] mt-2"
                    style={{ color: COLORS.textMuted }}
                  >
                    Just now • Type: system
                    {targetCustomerId.trim()
                      ? ` • Customer: ${targetCustomerId.trim().slice(0, 8)}…`
                      : ""}
                  </div>
                </div>

                <div
                  className="text-[0.7rem]"
                  style={{ color: COLORS.textMuted }}
                >
                  Just now
                </div>
              </div>
            </div>

            <div
              className="text-[0.7rem] mt-3"
              style={{ color: COLORS.textMuted }}
            >
              Tip: keep titles short and put details in the message body.
            </div>
          </div>
        </div>
      </div>

      {/* Error / Loading for list */}
      {error && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      )}

      {loading && !error && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: COLORS.highlightCardBg }}
        >
          Loading notifications...
        </div>
      )}

      {/* Filters + inbox */}
      {!loading && !error && (
        <div className="space-y-3">
          {/* Filters */}
          <div
            className="rounded-2xl p-4 border space-y-3"
            style={{
              backgroundColor: COLORS.cardBg,
              borderColor: COLORS.cardBorder,
              boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
            }}
          >
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  label="All audiences"
                  active={audienceFilter === "all"}
                  onClick={() => setAudienceFilter("all")}
                />
                <FilterChip
                  label="Customers"
                  active={audienceFilter === "customer"}
                  onClick={() => setAudienceFilter("customer")}
                />
                <FilterChip
                  label="Admins"
                  active={audienceFilter === "admin"}
                  onClick={() => setAudienceFilter("admin")}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <FilterChip
                  label="Unread"
                  active={readFilter === "unread"}
                  onClick={() => setReadFilter("unread")}
                />
                <FilterChip
                  label="All"
                  active={readFilter === "all"}
                  onClick={() => setReadFilter("all")}
                />
                <FilterChip
                  label="Read"
                  active={readFilter === "read"}
                  onClick={() => setReadFilter("read")}
                />
              </div>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  label="All types"
                  active={typeFilter === "all"}
                  onClick={() => setTypeFilter("all")}
                />
                <FilterChip
                  label="Payments"
                  active={typeFilter === "payment"}
                  onClick={() => setTypeFilter("payment")}
                />
                <FilterChip
                  label="Support"
                  active={typeFilter === "support"}
                  onClick={() => setTypeFilter("support")}
                />
                <FilterChip
                  label="Raffles"
                  active={typeFilter === "raffle"}
                  onClick={() => setTypeFilter("raffle")}
                />
                <FilterChip
                  label="System"
                  active={typeFilter === "system"}
                  onClick={() => setTypeFilter("system")}
                />
                <FilterChip
                  label="Other"
                  active={typeFilter === "other"}
                  onClick={() => setTypeFilter("other")}
                />
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={toggleSelectVisible}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border"
                  style={{
                    backgroundColor: COLORS.tabBg,
                    color: COLORS.textPrimary,
                    borderColor: COLORS.cardBorder,
                  }}
                >
                  Select visible
                </button>

                <button
                  type="button"
                  disabled={bulkBusy || !anySelected}
                  onClick={() => bulkMark(true)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-50"
                  style={{
                    backgroundColor: COLORS.success,
                    color: COLORS.textOnPrimary,
                    borderColor: COLORS.success,
                  }}
                >
                  Mark selected read
                </button>

                <button
                  type="button"
                  disabled={bulkBusy || !anySelected}
                  onClick={() => bulkMark(false)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border disabled:opacity-50"
                  style={{
                    backgroundColor: COLORS.tabBg,
                    color: COLORS.textPrimary,
                    borderColor: COLORS.cardBorder,
                  }}
                >
                  Mark selected unread
                </button>
              </div>
            </div>
          </div>

          {/* Inbox list */}
          {filtered.length === 0 ? (
            <EmptyState
              title="No notifications"
              description="No notifications match the current filters."
            />
          ) : (
            <div className="space-y-4">
              <NotificationGroup
                title="Today"
                items={grouped.Today}
                selected={selected}
                busyIds={busyIds}
                onToggle={toggleOne}
                onMarkRead={updateReadState}
              />
              <NotificationGroup
                title="Yesterday"
                items={grouped.Yesterday}
                selected={selected}
                busyIds={busyIds}
                onToggle={toggleOne}
                onMarkRead={updateReadState}
              />
              <NotificationGroup
                title="Earlier"
                items={grouped.Earlier}
                selected={selected}
                busyIds={busyIds}
                onToggle={toggleOne}
                onMarkRead={updateReadState}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-[0.75rem] font-medium border transition-colors"
      style={{
        backgroundColor: active ? COLORS.tabActiveBg : COLORS.tabBg,
        color: active ? COLORS.tabActiveTint : COLORS.tabInactiveTint,
        borderColor: COLORS.tabBorder,
      }}
    >
      {label}
    </button>
  );
}

function Pill({ label, kind }: { label: string; kind: "customer" | "admin" }) {
  return (
    <span
      className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: kind === "admin" ? COLORS.info : COLORS.tabActiveBg,
        color: COLORS.textOnPrimary,
      }}
    >
      {label}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const b = typeBucket(type);
  let bg = COLORS.tabActiveBg;
  let label = "Other";

  if (b === "payment") {
    bg = COLORS.success;
    label = "Payments";
  } else if (b === "support") {
    bg = COLORS.info;
    label = "Support";
  } else if (b === "raffle") {
    bg = COLORS.accent;
    label = "Raffles";
  } else if (b === "system") {
    bg = COLORS.warning;
    label = "System";
  }

  return (
    <span
      className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
      title={type}
    >
      {label}
    </span>
  );
}

function NotificationGroup({
  title,
  items,
  selected,
  busyIds,
  onToggle,
  onMarkRead,
}: {
  title: "Today" | "Yesterday" | "Earlier";
  items: NotificationRow[];
  selected: Record<string, boolean>;
  busyIds: Record<string, boolean>;
  onToggle: (id: string) => void;
  onMarkRead: (id: string, read: boolean) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-center justify-between"
        style={{
          backgroundColor: COLORS.highlightCardBg,
          borderColor: COLORS.cardBorder,
        }}
      >
        <span
          className="text-sm font-semibold"
          style={{ color: COLORS.textPrimary }}
        >
          {title}
        </span>
        <span className="text-xs" style={{ color: COLORS.textMuted }}>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="divide-y" style={{ borderColor: COLORS.cardBorder }}>
        {items.map((n) => (
          <NotificationItem
            key={n.id}
            n={n}
            checked={!!selected[n.id]}
            busy={!!busyIds[n.id]}
            onToggle={() => onToggle(n.id)}
            onMarkRead={(read) => onMarkRead(n.id, read)}
          />
        ))}
      </div>
    </div>
  );
}

function NotificationItem({
  n,
  checked,
  busy,
  onToggle,
  onMarkRead,
}: {
  n: NotificationRow;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
  onMarkRead: (read: boolean) => void;
}) {
  const isRead = !!n.is_read;

  const title = n.title.trim();
  const preview = n.body ? truncate(n.body.trim(), 180) : "No message body.";

  return (
    <div
      className="px-4 py-3 flex gap-3 hover:bg-gray-50 transition-colors"
      style={{
        backgroundColor: isRead ? COLORS.cardBg : "#F8FAFF",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Pill
                label={safeLower(n.audience) === "admin" ? "Admin" : "Customer"}
                kind={safeLower(n.audience) === "admin" ? "admin" : "customer"}
              />
              <TypePill type={n.type} />
              <span
                className="text-sm font-semibold truncate"
                style={{ color: COLORS.textPrimary }}
                title={title}
              >
                {title}
              </span>
              {!isRead && (
                <span
                  className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: COLORS.primary,
                    color: COLORS.textOnPrimary,
                  }}
                >
                  New
                </span>
              )}
            </div>

            <div
              className="text-xs mt-1"
              style={{ color: COLORS.textSecondary }}
            >
              {preview}
            </div>

            <div
              className="flex flex-wrap gap-2 mt-2 text-[0.7rem]"
              style={{ color: COLORS.textMuted }}
            >
              <span>{relativeTime(n.created_at)}</span>
              <span>•</span>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => copyToClipboard(n.id)}
                title="Copy notification ID"
              >
                Copy ID
              </button>
              {n.customer_id && (
                <>
                  <span>•</span>
                  <Link
                    href={`/customers/${n.customer_id}`}
                    className="underline underline-offset-4"
                    style={{ color: COLORS.primary }}
                    title="Open customer"
                  >
                    Customer {n.customer_id.slice(0, 8)}…
                  </Link>
                </>
              )}
              {n.raffle_id && (
                <>
                  <span>•</span>
                  <Link
                    href={`/raffles/${n.raffle_id}`}
                    className="underline underline-offset-4"
                    style={{ color: COLORS.primary }}
                    title="Open raffle"
                  >
                    Raffle {n.raffle_id.slice(0, 8)}…
                  </Link>
                </>
              )}
            </div>

            {n.read_at && (
              <div
                className="text-[0.7rem] mt-1"
                style={{ color: COLORS.textMuted }}
              >
                Read at: {new Date(n.read_at).toLocaleString("en-IE")}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className="text-[0.7rem]" style={{ color: COLORS.textMuted }}>
              {new Date(n.created_at).toLocaleString("en-IE", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onMarkRead(!isRead)}
                className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border disabled:opacity-50"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.tabBg,
                  color: COLORS.textPrimary,
                }}
              >
                {isRead ? "Mark unread" : "Mark read"}
              </button>

              {(n.customer_id || n.raffle_id) && (
                <Link
                  href={
                    n.raffle_id
                      ? `/raffles/${n.raffle_id}`
                      : `/customers/${n.customer_id}`
                  }
                  className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border"
                  style={{
                    borderColor: COLORS.primary,
                    backgroundColor: COLORS.primary,
                    color: COLORS.textOnPrimary,
                  }}
                >
                  Take action
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="rounded-2xl p-8 border text-center"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
      }}
    >
      <div
        className="text-sm font-semibold"
        style={{ color: COLORS.textPrimary }}
      >
        {title}
      </div>
      <div className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
        {description}
      </div>
    </div>
  );
}
