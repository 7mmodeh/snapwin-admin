// app/(admin)/notifications/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

        const { data, error } = await supabase
          .from("notifications")
          .select(
            "id, customer_id, raffle_id, type, audience, title, body, is_read, created_at, read_at"
          )
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;

        setNotifications((data ?? []) as NotificationRow[]);
      } catch (err: unknown) {
        console.error("Error loading notifications:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load notifications.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();
  }, []);

  const filtered = useMemo(() => {
    let result = [...notifications];

    if (audienceFilter !== "all") {
      result = result.filter(
        (n) => n.audience.toLowerCase() === audienceFilter
      );
    }

    if (readFilter === "unread") {
      result = result.filter((n) => !n.is_read);
    } else if (readFilter === "read") {
      result = result.filter((n) => n.is_read);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          (n.customer_id ?? "").toLowerCase().includes(q) ||
          (n.raffle_id ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [notifications, audienceFilter, readFilter, search]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;

    try {
      setCreating(true);
      setCreateError(null);
      setCreateSuccess(null);

      const payload = {
        title: newTitle.trim(),
        body: newBody.trim(),
        audience: newAudience as string, // matches your enum value
        type: "system" as string, // safe default
        customer_id: targetCustomerId.trim() || null,
        raffle_id: null,
        data: {},
        is_read: false,
      };

      const { data, error } = await supabase
        .from("notifications")
        .insert(payload)
        .select(
          "id, customer_id, raffle_id, type, audience, title, body, is_read, created_at, read_at"
        )
        .single<NotificationRow>();

      if (error) throw error;

      setNotifications((prev) => [data, ...prev]);
      setNewTitle("");
      setNewBody("");
      setTargetCustomerId("");
      setNewAudience("customer");
      setCreateSuccess("Notification created successfully.");
    } catch (err: unknown) {
      console.error("Error creating notification:", err);
      if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError("Failed to create notification.");
      }
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
                                n.audience === "admin"
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
