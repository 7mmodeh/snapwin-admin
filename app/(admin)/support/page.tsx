// app/(admin)/support/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type SupportRow = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  issue_type: string | null;
  topic: string | null;
  status: string;
  raffle_item_name: string | null;
  ticket_number: number | null;
  created_at: string;
};

type StatusFilter = "all" | "open" | "pending" | "closed";

export default function SupportListPage() {
  const [requests, setRequests] = useState<SupportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let mounted = true;

    const fetchSupport = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("support_requests")
          .select(
            "id, customer_name, customer_email, issue_type, topic, status, raffle_item_name, ticket_number, created_at"
          )
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (!mounted) return;
        setRequests((data ?? []) as SupportRow[]);
      } catch (err: unknown) {
        console.error("Error loading support requests:", err);
        if (!mounted) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load support requests.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchSupport();

    return () => {
      mounted = false;
    };
  }, []);

  // ✅ Realtime: update list live (INSERT/UPDATE/DELETE)
  useEffect(() => {
    const channel = supabase
      .channel("rt-admin-support-requests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_requests" },
        (payload) => {
          const eventType = payload.eventType;

          if (eventType === "INSERT") {
            const row = payload.new as any;
            setRequests((prev) => {
              const next = [row as SupportRow, ...prev];
              // de-dupe
              const seen = new Set<string>();
              return next.filter((r) => {
                if (seen.has(r.id)) return false;
                seen.add(r.id);
                return true;
              });
            });
            return;
          }

          if (eventType === "UPDATE") {
            const row = payload.new as any;
            setRequests((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, ...row } : r))
            );
            return;
          }

          if (eventType === "DELETE") {
            const row = payload.old as any;
            setRequests((prev) => prev.filter((r) => r.id !== row.id));
            return;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return requests;

    const norm = (s: string) => (s || "").toLowerCase();

    return requests.filter((r) => {
      const s = norm(r.status);

      if (statusFilter === "open") return s === "open";

      // ✅ Pending should also include mobile’s intermediate states
      if (statusFilter === "pending")
        return s === "pending" || s === "in_progress" || s === "waiting_customer";

      if (statusFilter === "closed") return s === "closed";

      return true;
    });
  }, [requests, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: COLORS.primary }}>
            Support
          </h1>
          <p style={{ color: COLORS.textSecondary }}>
            View and manage customer support requests.
          </p>
        </div>

        {/* Status filters */}
        <div className="flex flex-wrap gap-2">
          <StatusFilterButton
            label="All"
            value="all"
            activeValue={statusFilter}
            onClick={setStatusFilter}
          />
          <StatusFilterButton
            label="Open"
            value="open"
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
            label="Closed"
            value="closed"
            activeValue={statusFilter}
            onClick={setStatusFilter}
          />
        </div>
      </div>

      {/* Error / Loading */}
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
          Loading support requests...
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
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
              No support requests found for this filter.
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
                    <Th>Customer</Th>
                    <Th>Issue</Th>
                    <Th>Status</Th>
                    <Th>Raffle / Ticket</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((req) => (
                    <SupportRowItem key={req.id} req={req} />
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
      className="px-3 py-1 rounded-full text-xs font-medium border"
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

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}

function SupportRowItem({ req }: { req: SupportRow }) {
  const customer = req.customer_name || req.customer_email || "Unknown customer";

  return (
    <tr className="border-t" style={{ borderColor: COLORS.cardBorder }}>
      {/* Customer */}
      <td className="px-4 py-3 align-top">
        <Link href={`/support/${req.id}`}>
          <div>
            <div
              className="font-medium hover:underline"
              style={{ color: COLORS.textPrimary }}
            >
              {customer}
            </div>
            {req.customer_email && (
              <div className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
                {req.customer_email}
              </div>
            )}
          </div>
        </Link>
      </td>

      {/* Issue */}
      <td className="px-4 py-3 align-top">
        <div style={{ color: COLORS.textPrimary }}>{req.issue_type || "General"}</div>
        {req.topic && (
          <div
            className="text-xs mt-1 line-clamp-1"
            style={{ color: COLORS.textSecondary }}
          >
            {req.topic}
          </div>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3 align-top">
        <StatusBadge status={req.status} />
      </td>

      {/* Raffle / Ticket */}
      <td className="px-4 py-3 align-top">
        <div className="text-xs" style={{ color: COLORS.textSecondary }}>
          {req.raffle_item_name || "No raffle linked"}
        </div>
        {req.ticket_number != null && (
          <div className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
            Ticket #{req.ticket_number}
          </div>
        )}
      </td>

      {/* Created */}
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary, fontSize: "0.75rem" }}>
          {new Date(req.created_at).toLocaleString("en-IE")}
        </span>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = (status || "").toLowerCase();

  let bg = COLORS.info;
  let label = status || "—";

  if (lower === "open") {
    bg = COLORS.warning;
    label = "Open";
  } else if (lower === "pending" || lower === "in_progress" || lower === "waiting_customer") {
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
