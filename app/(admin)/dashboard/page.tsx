// app/(admin)/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";
type PaymentStatus = "pending" | "completed" | "failed";

type SupportStatus = "open" | "pending" | "closed";

type RaffleRow = {
  id: string;
  item_name: string;
  status: RaffleStatus;
  total_tickets: number;
  sold_tickets: number | null;
  ticket_price: number | string;
  draw_date: string | null;
  created_at: string;
};

type TicketRow = {
  id: string;
  raffle_id: string;
  payment_status: PaymentStatus;
  payment_amount: number | string | null;
  purchased_at: string | null;
};

type SupportRow = {
  id: string;
  status: string; // DB string, may be any casing
  issue_type: string;
  topic: string | null;
  raffle_id: string | null;
  customer_name: string | null;
  created_at: string;
};

type RangeKey = "7d" | "30d" | "90d" | "all";
type FeedFilter = "all" | "payments" | "support" | "raffles";

type ActivityItem =
  | {
      kind: "ticket_completed" | "ticket_failed" | "ticket_pending";
      ts: string;
      title: string;
      subtitle?: string;
      href: string;
    }
  | {
      kind: "support_created" | "support_updated";
      ts: string;
      title: string;
      subtitle?: string;
      href: string;
    }
  | {
      kind: "raffle_created" | "raffle_updated";
      ts: string;
      title: string;
      subtitle?: string;
      href: string;
    };

function safeLower(x: string | null | undefined) {
  return (x ?? "").toLowerCase().trim();
}

function toNumberMaybe(v: number | string | null): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function isoNow() {
  return new Date().toISOString();
}

function formatEuro(n: number) {
  return `€${n.toFixed(2)}`;
}

function buildQuery(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") s.set(k, v);
  });
  const q = s.toString();
  return q ? `?${q}` : "";
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [item, ...arr];
  const next = arr.slice();
  next[idx] = item;
  return next;
}

function sortDescByDate<T>(arr: T[], getIso: (x: T) => string | null): T[] {
  return [...arr].sort((a, b) => {
    const ta = getIso(a);
    const tb = getIso(b);
    const aa = ta ? new Date(ta).getTime() : 0;
    const bb = tb ? new Date(tb).getTime() : 0;
    return bb - aa;
  });
}

function normalizeSupportStatus(status: string): SupportStatus {
  const n = safeLower(status);
  if (n === "pending") return "pending";
  if (n === "closed") return "closed";
  return "open";
}

export default function DashboardPage() {
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [supports, setSupports] = useState<SupportRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("30d");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

  const [supportBusyIds, setSupportBusyIds] = useState<Record<string, boolean>>(
    {}
  );

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

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
            .limit(40),
        ]);

        if (rafflesRes.error) throw rafflesRes.error;
        if (ticketsRes.error) throw ticketsRes.error;
        if (supportsRes.error) throw supportsRes.error;

        if (!mountedRef.current) return;

        setRaffles((rafflesRes.data ?? []) as RaffleRow[]);
        setTickets((ticketsRes.data ?? []) as TicketRow[]);
        setSupports((supportsRes.data ?? []) as SupportRow[]);
      } catch (err: unknown) {
        console.error("Error loading dashboard data:", err);
        if (!mountedRef.current) return;

        if (err instanceof Error) setError(err.message);
        else setError("Failed to load dashboard data.");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchData();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        (payload) => {
          const newRow = payload.new as Partial<TicketRow> | null;
          if (!newRow || typeof newRow.id !== "string") return;

          const normalized: TicketRow = {
            id: newRow.id,
            raffle_id: String(newRow.raffle_id ?? ""),
            payment_status: (newRow.payment_status ??
              "pending") as PaymentStatus,
            payment_amount:
              (newRow.payment_amount as number | string | null) ?? null,
            purchased_at: (newRow.purchased_at as string | null) ?? null,
          };

          setTickets((prev) =>
            sortDescByDate(upsertById(prev, normalized), (t) => t.purchased_at)
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_requests" },
        (payload) => {
          const newRow = payload.new as Partial<SupportRow> | null;
          if (!newRow || typeof newRow.id !== "string") return;

          const normalized: SupportRow = {
            id: newRow.id,
            status: String(newRow.status ?? "open"),
            issue_type: String(newRow.issue_type ?? "General"),
            topic: (newRow.topic as string | null) ?? null,
            raffle_id: (newRow.raffle_id as string | null) ?? null,
            customer_name: (newRow.customer_name as string | null) ?? null,
            created_at: String(newRow.created_at ?? isoNow()),
          };

          setSupports((prev) =>
            sortDescByDate(
              upsertById(prev, normalized).slice(0, 60),
              (s) => s.created_at
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "raffles" },
        (payload) => {
          const newRow = payload.new as Partial<RaffleRow> | null;
          if (!newRow || typeof newRow.id !== "string") return;

          const normalized: RaffleRow = {
            id: newRow.id,
            item_name: String(newRow.item_name ?? "Untitled Raffle"),
            status: (newRow.status ?? "active") as RaffleStatus,
            total_tickets: Number(newRow.total_tickets ?? 0),
            sold_tickets:
              (newRow.sold_tickets as number | null | undefined) ?? null,
            ticket_price:
              (newRow.ticket_price as number | string | undefined) ?? 0,
            draw_date: (newRow.draw_date as string | null | undefined) ?? null,
            created_at: String(newRow.created_at ?? isoNow()),
          };

          setRaffles((prev) =>
            sortDescByDate(upsertById(prev, normalized), (r) => r.created_at)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const rangeInfo = useMemo(() => {
    if (range === "all")
      return { from: null as Date | null, label: "All time" };

    const now = new Date();
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      from,
      label:
        range === "7d"
          ? "Last 7 days"
          : range === "90d"
          ? "Last 90 days"
          : "Last 30 days",
    };
  }, [range]);

  const rangedTickets = useMemo(() => {
    if (!tickets.length) return [] as TicketRow[];
    if (!rangeInfo.from) return tickets;

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
    let pendingPayments = 0;

    const now = Date.now();
    let pendingStuck = 0;

    for (const t of rangedTickets) {
      if (t.payment_status === "completed") {
        completedPayments += 1;
        totalRevenue += toNumberMaybe(t.payment_amount);
      } else if (t.payment_status === "failed") {
        failedPayments += 1;
      } else {
        pendingPayments += 1;
        if (t.purchased_at) {
          const ts = new Date(t.purchased_at).getTime();
          const hours = (now - ts) / (1000 * 60 * 60);
          if (hours >= 6) pendingStuck += 1;
        }
      }
    }

    const activeRaffles = raffles.filter((r) => r.status === "active").length;

    const openSupports = supports.filter(
      (s) => normalizeSupportStatus(s.status) === "open"
    ).length;

    const supportsOver24h = supports.filter((s) => {
      if (normalizeSupportStatus(s.status) !== "open") return false;
      const ts = new Date(s.created_at).getTime();
      const hours = (Date.now() - ts) / (1000 * 60 * 60);
      return hours >= 24;
    }).length;

    const denom = completedPayments + failedPayments;
    const failureRate = denom > 0 ? failedPayments / denom : 0;

    const active = raffles.filter((r) => r.status === "active");
    let activeTotal = 0;
    let activeSold = 0;
    for (const r of active) {
      activeTotal += r.total_tickets || 0;
      activeSold += r.sold_tickets ?? 0;
    }
    const sellThrough = activeTotal > 0 ? activeSold / activeTotal : 0;

    return {
      totalRevenue,
      completedPayments,
      failedPayments,
      pendingPayments,
      pendingStuck,
      activeRaffles,
      openSupports,
      supportsOver24h,
      failureRate,
      sellThrough,
    };
  }, [rangedTickets, raffles, supports]);

  const recentRaffles = useMemo(() => raffles.slice(0, 5), [raffles]);
  const recentSupports = useMemo(() => supports.slice(0, 5), [supports]);

  const activityFeed = useMemo(() => {
    const items: ActivityItem[] = [];

    for (const t of tickets.slice(0, 40)) {
      const ts = t.purchased_at ?? null;
      if (!ts) continue;

      if (t.payment_status === "completed") {
        items.push({
          kind: "ticket_completed",
          ts,
          title: "Ticket sale completed",
          subtitle: `Amount: ${formatEuro(
            toNumberMaybe(t.payment_amount)
          )} • Raffle: ${t.raffle_id.slice(0, 8)}…`,
          href: `/tickets${buildQuery({ raffle_id: t.raffle_id })}`,
        });
      } else if (t.payment_status === "failed") {
        items.push({
          kind: "ticket_failed",
          ts,
          title: "Payment failed",
          subtitle: `Raffle: ${t.raffle_id.slice(0, 8)}…`,
          href: `/tickets${buildQuery({ status: "failed" })}`,
        });
      } else {
        items.push({
          kind: "ticket_pending",
          ts,
          title: "Payment pending",
          subtitle: `Raffle: ${t.raffle_id.slice(0, 8)}…`,
          href: `/tickets${buildQuery({ status: "pending" })}`,
        });
      }
    }

    for (const s of supports.slice(0, 40)) {
      items.push({
        kind: "support_created",
        ts: s.created_at,
        title: "Support request created",
        subtitle: `${s.issue_type}${
          s.customer_name ? ` • ${s.customer_name}` : ""
        }`,
        href: `/support/${s.id}`,
      });
    }

    for (const r of raffles.slice(0, 25)) {
      items.push({
        kind: "raffle_created",
        ts: r.created_at,
        title: "Raffle created/updated",
        subtitle: `${r.item_name} • Status: ${r.status}`,
        href: `/raffles/${r.id}`,
      });
    }

    const sorted = items.sort(
      (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
    );

    const filtered = sorted.filter((i) => {
      if (feedFilter === "all") return true;
      if (feedFilter === "payments")
        return (
          i.kind === "ticket_completed" ||
          i.kind === "ticket_failed" ||
          i.kind === "ticket_pending"
        );
      if (feedFilter === "support")
        return i.kind === "support_created" || i.kind === "support_updated";
      return i.kind === "raffle_created" || i.kind === "raffle_updated";
    });

    return filtered.slice(0, 25);
  }, [tickets, supports, raffles, feedFilter]);

  const exportCsv = () => {
    const rows = rangedTickets.map((t) => ({
      id: t.id,
      raffle_id: t.raffle_id,
      payment_status: t.payment_status,
      payment_amount: toNumberMaybe(t.payment_amount).toFixed(2),
      purchased_at: t.purchased_at ?? "",
    }));

    const header = [
      "id",
      "raffle_id",
      "payment_status",
      "payment_amount",
      "purchased_at",
    ];

    const csv = [
      header.join(","),
      ...rows.map((r) =>
        header
          .map((k) => {
            const v = r[k as keyof typeof r] ?? "";
            const s = String(v).replace(/"/g, '""');
            return `"${s}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `snapwin-tickets-${rangeInfo.label
      .replace(/\s+/g, "-")
      .toLowerCase()}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  const setSupportBusy = (id: string, busy: boolean) => {
    setSupportBusyIds((prev) => ({ ...prev, [id]: busy }));
  };

  const updateSupportStatus = async (id: string, nextStatus: SupportStatus) => {
    try {
      setSupportBusy(id, true);

      setSupports((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: nextStatus } : s))
      );

      const { error: updErr } = await supabase
        .from("support_requests")
        .update({ status: nextStatus })
        .eq("id", id);

      if (updErr) throw updErr;
    } catch (e) {
      console.error("Failed to update support status:", e);

      const { data, error: readErr } = await supabase
        .from("support_requests")
        .select(
          "id, status, issue_type, topic, raffle_id, customer_name, created_at"
        )
        .eq("id", id)
        .single();

      if (!readErr && data) {
        setSupports((prev) =>
          prev.map((s) => (s.id === id ? (data as SupportRow) : s))
        );
      }
    } finally {
      setSupportBusy(id, false);
    }
  };

  const metricLinks = useMemo(() => {
    const rangeParam = range;
    return {
      revenue: `/tickets${buildQuery({
        range: rangeParam,
        status: "completed",
      })}`,
      ticketsSold: `/tickets${buildQuery({
        range: rangeParam,
        status: "completed",
      })}`,
      activeRaffles: `/raffles${buildQuery({ status: "active" })}`,
      openSupport: `/support${buildQuery({ status: "open" })}`,
    };
  }, [range]);

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
            Operational dashboard for SnapWin: payments, raffles, and support.
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

      {/* Quick Actions */}
      <div
        className="rounded-2xl p-4 border flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
        }}
      >
        <div className="flex flex-col">
          <span
            className="text-sm font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            Quick actions
          </span>
          <span className="text-xs" style={{ color: COLORS.textMuted }}>
            Jump directly into high-impact admin workflows.
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <QuickAction href="/raffles/create" label="Create raffle" />
          <QuickAction
            href={`/support${buildQuery({ status: "open" })}`}
            label="Review open support"
          />
          <QuickAction
            href={`/tickets${buildQuery({ status: "failed", range })}`}
            label="Investigate failed payments"
          />
          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-2 rounded-xl text-xs font-semibold border transition-colors"
            style={{
              backgroundColor: COLORS.tabBg,
              color: COLORS.textPrimary,
              borderColor: COLORS.cardBorder,
            }}
            title="Export current range tickets as CSV"
          >
            Export tickets CSV
          </button>
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

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Revenue"
              value={formatEuro(metrics.totalRevenue)}
              helper={rangeInfo.label}
              accent="primary"
              href={metricLinks.revenue}
            />
            <MetricCard
              label="Tickets sold"
              value={metrics.completedPayments.toString()}
              helper="Completed payments"
              accent="success"
              href={metricLinks.ticketsSold}
            />
            <MetricCard
              label="Active raffles"
              value={metrics.activeRaffles.toString()}
              helper="Status: active"
              accent="accent"
              href={metricLinks.activeRaffles}
            />
            <MetricCard
              label="Open support"
              value={metrics.openSupports.toString()}
              helper="Awaiting resolution"
              accent="warning"
              href={metricLinks.openSupport}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <InfoCard title="Payment health">
              <InfoRow
                label="Failure rate"
                value={`${Math.round(metrics.failureRate * 100)}%`}
                hint="Failed / (Failed + Completed)"
              />
              <InfoRow
                label="Pending payments"
                value={`${metrics.pendingPayments}`}
                hint={
                  metrics.pendingStuck > 0
                    ? `${metrics.pendingStuck} pending > 6h`
                    : "No stuck pending"
                }
                warn={metrics.pendingStuck > 0}
              />
            </InfoCard>

            <InfoCard title="Support SLA">
              <InfoRow
                label="Open tickets"
                value={`${metrics.openSupports}`}
                hint="Currently awaiting resolution"
              />
              <InfoRow
                label="Open > 24h"
                value={`${metrics.supportsOver24h}`}
                hint="Prioritize these first"
                warn={metrics.supportsOver24h > 0}
              />
            </InfoCard>

            <InfoCard title="Sell-through (active raffles)">
              <InfoRow
                label="Sell-through"
                value={`${Math.round(metrics.sellThrough * 100)}%`}
                hint="Aggregate sold / total for active raffles"
              />
            </InfoCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <CardShell
              title="Live activity"
              subtitle="Merged feed across payments, support, and raffles."
            >
              <div className="flex flex-wrap gap-2">
                <RangeChip
                  label="All"
                  display="All"
                  active={feedFilter === "all"}
                  onClick={() => setFeedFilter("all")}
                />
                <RangeChip
                  label="Payments"
                  display="Payments"
                  active={feedFilter === "payments"}
                  onClick={() => setFeedFilter("payments")}
                />
                <RangeChip
                  label="Support"
                  display="Support"
                  active={feedFilter === "support"}
                  onClick={() => setFeedFilter("support")}
                />
                <RangeChip
                  label="Raffles"
                  display="Raffles"
                  active={feedFilter === "raffles"}
                  onClick={() => setFeedFilter("raffles")}
                />
              </div>

              {activityFeed.length === 0 ? (
                <EmptyState
                  title="No activity yet"
                  description="As events happen (sales, support, raffle changes), they will appear here."
                />
              ) : (
                <div className="space-y-2">
                  {activityFeed.map((a, idx) => (
                    <Link
                      key={`${a.kind}-${a.ts}-${idx}`}
                      href={a.href}
                      className="block rounded-xl border px-3 py-2 hover:bg-gray-50 transition-colors"
                      style={{
                        borderColor: COLORS.cardBorder,
                        backgroundColor: COLORS.highlightCardBg,
                        color: COLORS.textPrimary,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-flex h-2 w-2 rounded-full mt-1"
                              style={{
                                backgroundColor: activityDotColor(a.kind),
                              }}
                            />
                            <span className="text-xs font-semibold truncate">
                              {a.title}
                            </span>
                          </div>
                          {a.subtitle && (
                            <div
                              className="text-[0.75rem] line-clamp-1 mt-0.5"
                              style={{ color: COLORS.textSecondary }}
                            >
                              {a.subtitle}
                            </div>
                          )}
                        </div>
                        <span
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textMuted }}
                        >
                          {new Date(a.ts).toLocaleString("en-IE", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardShell>

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
                    <div className="col-span-6">Raffle</div>
                    <div className="col-span-3">Progress</div>
                    <div className="col-span-3 text-right">Status</div>
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
                          <div className="col-span-6 flex flex-col min-w-0">
                            <span className="font-medium truncate">
                              {r.item_name}
                            </span>
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textMuted }}
                            >
                              {sold} / {total} tickets •{" "}
                              {new Date(r.created_at).toLocaleDateString(
                                "en-IE"
                              )}
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

                          <div className="col-span-3 flex items-center justify-end gap-2">
                            <StatusBadge status={r.status} />
                            <span
                              className="text-[0.7rem] underline underline-offset-4"
                              style={{ color: COLORS.primary }}
                            >
                              View
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
                    <div className="col-span-6">Issue</div>
                    <div className="col-span-3">Status</div>
                    <div className="col-span-3 text-right">Actions</div>
                  </div>

                  <div
                    className="divide-y"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    {recentSupports.map((s) => {
                      const busy = !!supportBusyIds[s.id];

                      return (
                        <div
                          key={s.id}
                          className="grid grid-cols-12 px-3 py-2 text-xs"
                          style={{ color: COLORS.textPrimary }}
                        >
                          <Link
                            href={`/support/${s.id}`}
                            className="col-span-6 flex flex-col min-w-0 hover:opacity-90"
                          >
                            <span className="font-medium truncate">
                              {s.issue_type}
                            </span>
                            <span
                              className="text-[0.7rem] line-clamp-1"
                              style={{ color: COLORS.textMuted }}
                            >
                              {s.topic || "No subject"}
                              {s.customer_name ? ` • ${s.customer_name}` : ""}
                            </span>
                          </Link>

                          <div className="col-span-3 flex items-center gap-2">
                            <SupportStatusBadge status={s.status} />
                            <span
                              className="text-[0.7rem]"
                              style={{ color: COLORS.textMuted }}
                            >
                              {new Date(s.created_at).toLocaleDateString(
                                "en-IE"
                              )}
                            </span>
                          </div>

                          <div className="col-span-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                updateSupportStatus(s.id, "pending")
                              }
                              className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border disabled:opacity-50"
                              style={{
                                borderColor: COLORS.cardBorder,
                                backgroundColor: COLORS.tabBg,
                                color: COLORS.textPrimary,
                              }}
                              title="Mark as pending"
                            >
                              Pending
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                updateSupportStatus(s.id, "closed")
                              }
                              className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border disabled:opacity-50"
                              style={{
                                borderColor: COLORS.cardBorder,
                                backgroundColor: COLORS.success,
                                color: COLORS.textOnPrimary,
                              }}
                              title="Mark as closed"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
  href,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: "primary" | "success" | "warning" | "accent";
  href?: string;
}) {
  const accentColor =
    accent === "success"
      ? COLORS.success
      : accent === "warning"
      ? COLORS.warning
      : accent === "accent"
      ? COLORS.accent
      : COLORS.primary;

  const body = (
    <div
      className="relative overflow-hidden rounded-2xl p-4 flex flex-col gap-2 border bg-gradient-to-br transition-colors"
      style={{
        borderColor: COLORS.cardBorder,
        backgroundColor: COLORS.cardBg,
        boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
      }}
    >
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

      {href && (
        <span
          className="text-[0.7rem] font-semibold underline underline-offset-4 mt-1"
          style={{ color: COLORS.primary }}
        >
          Drill down
        </span>
      )}
    </div>
  );

  if (!href) return body;

  return (
    <Link href={href} className="block hover:opacity-95">
      {body}
    </Link>
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

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-2 rounded-xl text-xs font-semibold border transition-colors hover:opacity-90"
      style={{
        backgroundColor: COLORS.primary,
        color: COLORS.textOnPrimary,
        borderColor: COLORS.primary,
      }}
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: RaffleStatus }) {
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

/**
 * FIX: Accept `string` (any casing), normalize internally.
 * This removes the "Open is not assignable to SupportStatus" error everywhere.
 */
function SupportStatusBadge({ status }: { status: string }) {
  const normalized = normalizeSupportStatus(status);

  let bg = COLORS.tabActiveBg;
  const color = COLORS.textOnPrimary;
  let label = status;

  if (normalized === "open") {
    bg = COLORS.warning;
    label = "Open";
  } else if (normalized === "pending") {
    bg = COLORS.info;
    label = "Pending";
  } else {
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
  subtitle,
  actionLabel,
  href,
  children,
}: {
  title: string;
  subtitle?: string;
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            className="text-lg font-semibold tracking-tight"
            style={{ color: COLORS.textPrimary }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: COLORS.textMuted }}>
              {subtitle}
            </p>
          )}
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

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4 border space-y-3"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        boxShadow: `0 16px 30px ${COLORS.cardShadow}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold"
          style={{ color: COLORS.textPrimary }}
        >
          {title}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div
          className="text-xs font-semibold"
          style={{ color: COLORS.textSecondary }}
        >
          {label}
        </div>
        {hint && (
          <div
            className="text-[0.7rem]"
            style={{ color: warn ? COLORS.warning : COLORS.textMuted }}
          >
            {hint}
          </div>
        )}
      </div>
      <div
        className="text-sm font-semibold"
        style={{ color: warn ? COLORS.warning : COLORS.textPrimary }}
      >
        {value}
      </div>
    </div>
  );
}

function activityDotColor(kind: ActivityItem["kind"]) {
  if (kind === "ticket_completed") return COLORS.success;
  if (kind === "ticket_failed") return COLORS.error;
  if (kind === "ticket_pending") return COLORS.warning;
  if (kind === "support_created" || kind === "support_updated")
    return COLORS.info;
  return COLORS.accent;
}
