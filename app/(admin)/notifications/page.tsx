// app/(admin)/notifications/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");

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

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await supabase
          .from("notifications")
          .select(NOTIFICATIONS_SELECT)
          .order("created_at", { ascending: false })
          .limit(200);

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

        setNotifications(normalized);
      } catch (err: unknown) {
        console.error("Error loading notifications:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load notifications."
        );
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();
  }, []);

  const filtered = useMemo(() => {
    let result = [...notifications];

    if (audienceFilter !== "all") {
      const af = audienceFilter.toLowerCase();
      result = result.filter((n) => (n.audience || "").toLowerCase() === af);
    }

    if (readFilter === "unread") {
      result = result.filter((n) => !n.is_read);
    } else if (readFilter === "read") {
      result = result.filter((n) => n.is_read);
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
  }, [notifications, audienceFilter, readFilter, search]);

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
        data: {}, // if your table doesn't have `data`, remove this line
        is_read: false,
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
            View and send system notifications to customers or admins.
          </p>
        </div>

        {/* Search */}
        <div className="w-full md:w-72">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, body, customer/raffle ID..."
            className="w-full border rounded px-3 py-2 text-sm"
            style={{
              borderColor: COLORS.inputBorder,
              backgroundColor: COLORS.inputBg,
              color: COLORS.textPrimary,
            }}
          />
        </div>
      </div>

      {/* Create notification card */}
      <div
        className="rounded-lg p-4 space-y-3"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          borderWidth: 1,
          boxShadow: `0 8px 20px ${COLORS.cardShadow}`,
        }}
      >
        <h2
          className="text-lg font-semibold"
          style={{ color: COLORS.textPrimary }}
        >
          Create notification
        </h2>

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
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
              rows={3}
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

        <div className="flex justify-end pt-2">
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
            {creating ? "Creating..." : "Create notification"}
          </button>
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

      {/* Filters + table */}
      {!loading && !error && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center justify-between">
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
                label="All"
                active={readFilter === "all"}
                onClick={() => setReadFilter("all")}
              />
              <FilterChip
                label="Unread"
                active={readFilter === "unread"}
                onClick={() => setReadFilter("unread")}
              />
              <FilterChip
                label="Read"
                active={readFilter === "read"}
                onClick={() => setReadFilter("read")}
              />
            </div>
          </div>

          {/* Table */}
          <div
            className="rounded-lg overflow-hidden"
            style={{
              backgroundColor: COLORS.cardBg,
              borderColor: COLORS.cardBorder,
              borderWidth: 1,
            }}
          >
            {filtered.length === 0 ? (
              <div className="p-4" style={{ color: COLORS.textMuted }}>
                No notifications found for this filter.
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
                      <th className="px-3 py-2 text-left">Title</th>
                      <th className="px-3 py-2 text-left">Audience</th>
                      <th className="px-3 py-2 text-left">Read</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Raffle</th>
                      <th className="px-3 py-2 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((n) => (
                      <tr
                        key={n.id}
                        className="border-t"
                        style={{ borderColor: COLORS.cardBorder }}
                      >
                        <td className="px-3 py-2 align-top">
                          <div
                            className="font-medium"
                            style={{ color: COLORS.textPrimary }}
                          >
                            {n.title}
                          </div>
                          <div
                            className="text-[0.7rem] mt-1 line-clamp-2"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {n.body}
                          </div>
                          <div
                            className="text-[0.65rem] mt-1"
                            style={{ color: COLORS.textMuted }}
                          >
                            ID: {n.id}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <span
                            className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
                            style={{
                              backgroundColor:
                                n.audience.toLowerCase() === "admin"
                                  ? COLORS.info
                                  : COLORS.tabActiveBg,
                              color: COLORS.textOnPrimary,
                            }}
                          >
                            {n.audience}
                          </span>
                        </td>

                        <td className="px-3 py-2 align-top">
                          {n.is_read ? (
                            <span
                              className="text-[0.75rem]"
                              style={{ color: COLORS.textSecondary }}
                            >
                              Read
                            </span>
                          ) : (
                            <span
                              className="text-[0.75rem]"
                              style={{ color: COLORS.warning }}
                            >
                              Unread
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <div
                            className="text-[0.7rem]"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {n.customer_id ?? "—"}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <div
                            className="text-[0.7rem]"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {n.raffle_id ?? "—"}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <span
                            className="text-[0.7rem]"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {new Date(n.created_at).toLocaleString("en-IE")}
                          </span>
                          {n.read_at && (
                            <div
                              className="text-[0.6rem] mt-1"
                              style={{ color: COLORS.textMuted }}
                            >
                              Read:{" "}
                              {new Date(n.read_at).toLocaleString("en-IE")}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
      className="px-3 py-1 rounded-full text-[0.7rem] font-medium border"
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
