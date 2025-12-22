// app/(admin)/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type RaffleRow = {
  id: string;
  item_name: string;
  status: "active" | "soldout" | "drawn" | "cancelled";
  total_tickets: number;
  sold_tickets: number | null;
  ticket_price: number | string;
  draw_date: string | null;
  created_at: string;
};

type TicketRow = {
  id: string;
  raffle_id: string;
  payment_status: "pending" | "completed" | "failed";
  payment_amount: number | string | null;
  purchased_at: string | null;
};

type SupportRow = {
  id: string;
  status: string;
  issue_type: string;
  topic: string | null;
  raffle_id: string | null;
  customer_name: string | null;
  created_at: string;
};

type RangeKey = "7d" | "30d" | "90d" | "all";

export default function DashboardPage() {
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [supports, setSupports] = useState<SupportRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("30d");

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const now = new Date();
        const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

        const [rafflesRes, ticketsRes, supportsRes] = await Promise.all([
          supabase
            .from("raffles")
            .select(
              "id, item_name, status, total_tickets, sold_tickets, ticket_price, draw_date, created_at"
            )
            .order("created_at", { ascending: false }),
          supabase
            .from("tickets")
            .select(
              "id, raffle_id, payment_status, payment_amount, purchased_at"
            )
            .gte("purchased_at", oneYearAgo.toISOString())
            .order("purchased_at", { ascending: false }),
          supabase
            .from("support_requests")
            .select(
              "id, status, issue_type, topic, raffle_id, customer_name, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        if (rafflesRes.error) throw rafflesRes.error;
        if (ticketsRes.error) throw ticketsRes.error;
        if (supportsRes.error) throw supportsRes.error;

        setRaffles((rafflesRes.data ?? []) as RaffleRow[]);
        setTickets((ticketsRes.data ?? []) as TicketRow[]);
        setSupports((supportsRes.data ?? []) as SupportRow[]);
      } catch (err: unknown) {
        console.error("Error loading dashboard data:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load dashboard data.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const rangeInfo = useMemo(() => {
    if (range === "all") {
      return { from: null as Date | null, label: "All time" };
    }

    const now = new Date();
    let days = 30;
    if (range === "7d") days = 7;
    if (range === "90d") days = 90;

    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      from,
      label:
        range === "7d"
          ? "Last 7 days"
          : range === "30d"
          ? "Last 30 days"
          : "Last 90 days",
    };
  }, [range]);

  const rangedTickets = useMemo(() => {
    if (!tickets.length) return [] as TicketRow[];

    if (!rangeInfo.from) {
      return tickets;
    }

    const fromTime = rangeInfo.from.getTime();

    return tickets.filter((t) => {
      if (!t.purchased_at) return false;
      const ts = new Date(t.purchased_at).getTime();
      return ts >= fromTime;
    });
  }, [tickets, rangeInfo.from]);

  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let completedPayments = 0;
    let failedPayments = 0;

    for (const t of rangedTickets) {
      if (t.payment_status === "completed") {
        completedPayments += 1;

        const amt =
          typeof t.payment_amount === "number"
            ? t.payment_amount
            : t.payment_amount != null
            ? parseFloat(t.payment_amount as string)
            : 0;

        if (!Number.isNaN(amt)) {
          totalRevenue += amt;
        }
      } else if (t.payment_status === "failed") {
        failedPayments += 1;
      }
    }

    const activeRaffles = raffles.filter((r) => r.status === "active").length;

    const openSupports = supports.filter(
      (s) => s.status.toLowerCase() === "open"
    ).length;

    return {
      totalRevenue,
      completedPayments,
      failedPayments,
      activeRaffles,
      openSupports,
    };
  }, [rangedTickets, raffles, supports]);

  const recentRaffles = useMemo(() => raffles.slice(0, 5), [raffles]);

  const recentSupports = useMemo(() => supports.slice(0, 5), [supports]);

  return (
    <div className="space-y-6">
      {/* Header + range selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Overview
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            High-level summary of SnapWin performance, payments, and support.
          </p>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <div className="flex flex-wrap gap-2 justify-end">
            <RangeChip
              label="7d"
              display="Last 7 days"
              active={range === "7d"}
              onClick={() => setRange("7d")}
            />
            <RangeChip
              label="30d"
              display="Last 30 days"
              active={range === "30d"}
              onClick={() => setRange("30d")}
            />
            <RangeChip
              label="90d"
              display="Last 90 days"
              active={range === "90d"}
              onClick={() => setRange("90d")}
            />
            <RangeChip
              label="All"
              display="All time"
              active={range === "all"}
              onClick={() => setRange("all")}
            />
          </div>
          <span className="text-xs" style={{ color: COLORS.textMuted }}>
            Metrics based on: {rangeInfo.label}
          </span>
        </div>
      </div>

      {/* Error / loading */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: "#FEF2F2",
            color: COLORS.error,
            borderColor: "#FCA5A5",
          }}
        >
          {error}
        </div>
      )}

      {loading && !error && (
        <div
          className="rounded-xl px-4 py-3 text-sm border animate-pulse"
          style={{
            backgroundColor: COLORS.highlightCardBg,
            borderColor: COLORS.cardBorder,
          }}
        >
          Loading dashboard...
        </div>
      )}

      {/* Metrics */}
      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Revenue"
              value={`€${metrics.totalRevenue.toFixed(2)}`}
              helper={rangeInfo.label}
              accent="primary"
            />
            <MetricCard
              label="Tickets sold"
              value={metrics.completedPayments.toString()}
              helper="Completed payments"
              accent="success"
            />
            <MetricCard
              label="Active raffles"
              value={metrics.activeRaffles.toString()}
              helper="Status: active"
              accent="accent"
            />
            <MetricCard
              label="Open support"
              value={metrics.openSupports.toString()}
              helper="Awaiting resolution"
              accent="warning"
            />
          </div>

          {/* Recent sections */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <CardShell
              title="Recent raffles"
              actionLabel="View all raffles"
              href="/raffles"
            >
              {recentRaffles.length === 0 ? (
                <EmptyState
                  title="No raffles yet"
                  description="Create your first raffle to see performance here."
                />
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <div
                    className="grid grid-cols-12 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: COLORS.highlightCardBg,
                      color: COLORS.textSecondary,
                      borderColor: COLORS.cardBorder,
                      borderBottomWidth: 1,
                    }}
                  >
                    <div className="col-span-5">Raffle</div>
                    <div className="col-span-3">Progress</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2 text-right">Created</div>
                  </div>

                  <div
                    className="divide-y"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    {recentRaffles.map((r) => {
                      const sold = r.sold_tickets ?? 0;
                      const total = r.total_tickets;
                      const percent =
                        total > 0 ? Math.round((sold / total) * 100) : 0;

                      return (
                        <Link
                          key={r.id}
                          href={`/raffles/${r.id}`}
                          className="grid grid-cols-12 px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                          style={{ color: COLORS.textPrimary }}
                        >
                          <div className="col-span-5 flex flex-col">
                            <span className="font-medium truncate">
                              {r.item_name}
                            </span>
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textMuted }}
                            >
                              {sold} / {total} tickets
                            </span>
                          </div>

                          <div className="col-span-3 flex flex-col justify-center gap-1">
                            <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-200">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${percent}%`,
                                  backgroundColor: COLORS.raffleSoldProgress,
                                }}
                              />
                            </div>
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textSecondary }}
                            >
                              {percent}% sold
                            </span>
                          </div>

                          <div className="col-span-2 flex items-center">
                            <StatusBadge status={r.status} />
                          </div>

                          <div className="col-span-2 flex items-center justify-end">
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textSecondary }}
                            >
                              {new Date(r.created_at).toLocaleDateString(
                                "en-IE"
                              )}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardShell>

            <CardShell
              title="Recent support"
              actionLabel="View all support"
              href="/support"
            >
              {recentSupports.length === 0 ? (
                <EmptyState
                  title="No support requests"
                  description="New customer issues will appear here in real time."
                />
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <div
                    className="grid grid-cols-12 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: COLORS.highlightCardBg,
                      color: COLORS.textSecondary,
                      borderColor: COLORS.cardBorder,
                      borderBottomWidth: 1,
                    }}
                  >
                    <div className="col-span-5">Issue</div>
                    <div className="col-span-3">Customer</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2 text-right">Created</div>
                  </div>

                  <div
                    className="divide-y"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    {recentSupports.map((s) => (
                      <Link
                        key={s.id}
                        href={`/support/${s.id}`}
                        className="grid grid-cols-12 px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                        style={{ color: COLORS.textPrimary }}
                      >
                        <div className="col-span-5 flex flex-col">
                          <span className="font-medium truncate">
                            {s.issue_type}
                          </span>
                          <span
                            className="text-[0.7rem] line-clamp-1"
                            style={{ color: COLORS.textMuted }}
                          >
                            {s.topic || "No subject"}
                          </span>
                        </div>

                        <div className="col-span-3 flex flex-col">
                          <span
                            className="text-[0.75rem]"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {s.customer_name || "Unknown customer"}
                          </span>
                          {s.raffle_id && (
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textMuted }}
                            >
                              Raffle: {s.raffle_id.slice(0, 8)}…
                            </span>
                          )}
                        </div>

                        <div className="col-span-2 flex items-center">
                          <SupportStatusBadge status={s.status} />
                        </div>

                        <div className="col-span-2 flex items-center justify-end">
                          <span
                            className="text-[0.7rem]"
                            style={{ color: COLORS.textSecondary }}
                          >
                            {new Date(s.created_at).toLocaleDateString("en-IE")}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardShell>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------- Presentational components ------------------------ */

function MetricCard({
  label,
  value,
  helper,
  accent,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: "primary" | "success" | "warning" | "accent";
}) {
  const accentColor =
    accent === "success"
      ? COLORS.success
      : accent === "warning"
      ? COLORS.warning
      : accent === "accent"
      ? COLORS.accent
      : COLORS.primary;

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-2 border bg-gradient-to-br"
      style={{
        borderColor: COLORS.cardBorder,
        backgroundColor: COLORS.cardBg,
        boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
      }}
    >
      {/* soft accent blob */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-20"
        style={{ backgroundColor: accentColor }}
      />

      <span
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: COLORS.textSecondary }}
      >
        {label}
      </span>
      <span
        className="text-2xl font-semibold tracking-tight"
        style={{ color: COLORS.primary }}
      >
        {value}
      </span>
      {helper && (
        <span className="text-xs" style={{ color: COLORS.textMuted }}>
          {helper}
        </span>
      )}
    </div>
  );
}

function RangeChip({
  label,
  display,
  active,
  onClick,
}: {
  label: string;
  display: string;
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
      title={display}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: RaffleRow["status"] }) {
  let bg = COLORS.info;
  let label: string = status;

  if (status === "active") {
    bg = COLORS.success;
    label = "Active";
  } else if (status === "soldout") {
    bg = COLORS.warning;
    label = "Sold out";
  } else if (status === "drawn") {
    bg = COLORS.primary;
    label = "Drawn";
  } else if (status === "cancelled") {
    bg = COLORS.error;
    label = "Cancelled";
  }

  return (
    <span
      className="text-[0.7rem] font-semibold px-2 py-1 rounded-full inline-flex items-center justify-center"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
    >
      {label}
    </span>
  );
}

function SupportStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let bg = COLORS.tabActiveBg;
  const color = COLORS.textOnPrimary;
  let label = status;

  if (normalized === "open") {
    bg = COLORS.warning;
    label = "Open";
  } else if (normalized === "pending") {
    bg = COLORS.info;
    label = "Pending";
  } else if (normalized === "closed") {
    bg = COLORS.success;
    label = "Closed";
  }

  return (
    <span
      className="text-[0.7rem] font-semibold px-2 py-1 rounded-full inline-flex items-center justify-center"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

function CardShell({
  title,
  actionLabel,
  href,
  children,
}: {
  title: string;
  actionLabel?: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4 space-y-4 border"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2
            className="text-lg font-semibold tracking-tight"
            style={{ color: COLORS.textPrimary }}
          >
            {title}
          </h2>
        </div>
        {href && actionLabel && (
          <Link
            href={href}
            className="text-[0.75rem] font-medium underline underline-offset-4"
            style={{ color: COLORS.primary }}
          >
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
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
      className="rounded-xl border px-4 py-6 text-center flex flex-col items-center justify-center gap-1"
      style={{
        borderColor: COLORS.cardBorder,
        backgroundColor: COLORS.highlightCardBg,
      }}
    >
      <span
        className="text-sm font-medium"
        style={{ color: COLORS.textPrimary }}
      >
        {title}
      </span>
      <span
        className="text-xs max-w-sm"
        style={{ color: COLORS.textSecondary }}
      >
        {description}
      </span>
    </div>
  );
}
