// app/(admin)/raffles/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";
type StatusFilter = "all" | RaffleStatus;

type RaffleRow = {
  id: string;
  item_name: string;
  item_image_url: string | null;
  status: RaffleStatus;
  total_tickets: number;
  sold_tickets: number | null;
  ticket_price: number | string;
  draw_date: string | null;
  created_at: string;
  max_tickets_per_customer: number; // expected to exist, fallback handled
};

/**
 * Raw shape from Supabase (unknown / any-safe).
 * We normalize this to RaffleRow with runtime guards.
 */
type RaffleRowRaw = {
  id?: unknown;
  item_name?: unknown;
  item_image_url?: unknown;
  status?: unknown;
  total_tickets?: unknown;
  sold_tickets?: unknown;
  ticket_price?: unknown;
  draw_date?: unknown;
  created_at?: unknown;
  max_tickets_per_customer?: unknown;
};

function isRaffleStatus(v: unknown): v is RaffleStatus {
  return (
    v === "active" || v === "soldout" || v === "drawn" || v === "cancelled"
  );
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

function normalizeRaffleRow(raw: RaffleRowRaw): RaffleRow | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const item_name = typeof raw.item_name === "string" ? raw.item_name : null;
  const status = isRaffleStatus(raw.status) ? raw.status : null;

  const total_tickets = toNumberOrNull(raw.total_tickets);
  const sold_tickets = toNumberOrNull(raw.sold_tickets);

  const created_at = typeof raw.created_at === "string" ? raw.created_at : null;

  if (!id || !item_name || !status || total_tickets == null || !created_at) {
    return null;
  }

  const item_image_url = toStringOrNull(raw.item_image_url);
  const draw_date = toStringOrNull(raw.draw_date);

  // ticket_price can be number or string (as in your schema)
  const ticket_price =
    typeof raw.ticket_price === "number" || typeof raw.ticket_price === "string"
      ? raw.ticket_price
      : 0;

  const maxTPC = toNumberOrNull(raw.max_tickets_per_customer);
  const max_tickets_per_customer = maxTPC != null && maxTPC >= 1 ? maxTPC : 3;

  return {
    id,
    item_name,
    item_image_url,
    status,
    total_tickets,
    sold_tickets,
    ticket_price,
    draw_date,
    created_at,
    max_tickets_per_customer,
  };
}

export default function RafflesPage() {
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    const fetchRaffles = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error: qErr } = await supabase
          .from("raffles")
          .select(
            "id, item_name, item_image_url, status, total_tickets, sold_tickets, ticket_price, draw_date, created_at, max_tickets_per_customer"
          )
          .order("created_at", { ascending: false });

        if (qErr) throw qErr;

        const rawList: RaffleRowRaw[] = Array.isArray(data)
          ? (data as unknown as RaffleRowRaw[])
          : [];

        const normalized: RaffleRow[] = [];
        for (const r of rawList) {
          const n = normalizeRaffleRow(r);
          if (n) normalized.push(n);
        }

        setRaffles(normalized);
      } catch (err: unknown) {
        console.error("Error loading raffles:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load raffles."
        );
        setRaffles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRaffles();
  }, []);

  const filteredRaffles = useMemo(() => {
    if (statusFilter === "all") return raffles;
    return raffles.filter((r) => r.status === statusFilter);
  }, [raffles, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Raffles
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Manage and review all SnapWin raffles.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          {/* Status filters */}
          <div className="flex flex-wrap gap-2">
            <StatusFilterButton
              label="All"
              value="all"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Active"
              value="active"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Sold out"
              value="soldout"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Drawn"
              value="drawn"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
            <StatusFilterButton
              label="Cancelled"
              value="cancelled"
              activeValue={statusFilter}
              onClick={setStatusFilter}
            />
          </div>

          {/* New raffle button */}
          <Link
            href="/raffles/create"
            className="px-4 py-2 rounded-full text-sm font-medium text-center shadow-sm"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              boxShadow: `0 10px 24px ${COLORS.cardShadow}`,
            }}
          >
            + New raffle
          </Link>
        </div>
      </div>

      {/* Error / Loading */}
      {error && (
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
      )}

      {loading && !error && (
        <div
          className="rounded-2xl px-4 py-3 text-sm border animate-pulse"
          style={{
            backgroundColor: COLORS.highlightCardBg,
            borderColor: COLORS.cardBorder,
            color: COLORS.textSecondary,
          }}
        >
          Loading raffles...
        </div>
      )}

      {/* Table card */}
      {!loading && !error && (
        <div
          className="rounded-2xl overflow-hidden border"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
          }}
        >
          {filteredRaffles.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div
                className="text-sm font-medium"
                style={{ color: COLORS.textPrimary }}
              >
                No raffles found
              </div>
              <div
                className="text-xs max-w-md mx-auto"
                style={{ color: COLORS.textSecondary }}
              >
                Try switching the status filter or create a new raffle to see it
                listed here.
              </div>
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
                    <Th>Item</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Ticket price</Th>
                    <Th className="text-right">Tickets</Th>
                    <Th className="text-right">Sold %</Th>
                    <Th className="text-right">Max / customer</Th>
                    <Th>Draw date</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRaffles.map((raffle, index) => (
                    <RaffleRowItem
                      key={raffle.id}
                      raffle={raffle}
                      striped={index % 2 === 1}
                    />
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
      className="px-3 py-1.5 rounded-full text-[0.75rem] font-medium border transition-colors"
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
      className={`px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}

function RaffleRowItem({
  raffle,
  striped,
}: {
  raffle: RaffleRow;
  striped: boolean;
}) {
  const sold = raffle.sold_tickets ?? 0;
  const total = raffle.total_tickets;
  const soldPercent = total > 0 ? Math.round((sold / total) * 100) : 0;

  const price =
    typeof raffle.ticket_price === "number"
      ? raffle.ticket_price
      : Number(raffle.ticket_price);

  const thumbSrc = raffle.item_image_url || "/vercel.svg";

  return (
    <tr
      className="border-t transition-colors hover:bg-gray-50"
      style={{
        borderColor: COLORS.cardBorder,
        backgroundColor: striped ? "#FAFAF9" : COLORS.cardBg,
      }}
    >
      {/* Item */}
      <td className="px-4 py-3 align-top">
        <Link href={`/raffles/${raffle.id}`} className="block">
          <div className="flex items-start gap-3">
            {/* Thumbnail frame (no crop, no overflow) */}
            <div
              className="flex-shrink-0 rounded-lg border overflow-hidden"
              style={{
                width: 56,
                height: 56,
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.highlightCardBg,
              }}
            >
              <div className="relative w-full h-full">
                <Image
                  src={thumbSrc}
                  alt={raffle.item_name}
                  fill
                  className="object-contain"
                  sizes="56px"
                />
              </div>
            </div>

            <div className="min-w-0">
              <div
                className="font-medium hover:underline truncate"
                style={{ color: COLORS.textPrimary }}
                title={raffle.item_name}
              >
                {raffle.item_name}
              </div>
              <div
                className="text-[0.7rem] mt-1 truncate"
                style={{ color: COLORS.textSecondary }}
                title={raffle.id}
              >
                ID: {raffle.id}
              </div>
            </div>
          </div>
        </Link>
      </td>

      {/* Status */}
      <td className="px-4 py-3 align-top">
        <StatusBadge status={raffle.status} />
      </td>

      {/* Ticket price */}
      <td className="px-4 py-3 align-top text-right">
        <span style={{ color: COLORS.textPrimary }}>
          {Number.isFinite(price) ? `€${price.toFixed(2)}` : "-"}
        </span>
      </td>

      {/* Tickets */}
      <td className="px-4 py-3 align-top text-right">
        <span style={{ color: COLORS.textPrimary }}>
          {sold} / {total}
        </span>
      </td>

      {/* Sold % + mini bar */}
      <td className="px-4 py-3 align-top text-right">
        <div className="text-xs mb-1" style={{ color: COLORS.textSecondary }}>
          {soldPercent}%
        </div>
        <div
          className="w-full h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: COLORS.raffleRemaining }}
        >
          <div
            className="h-2 rounded-full"
            style={{
              width: `${soldPercent}%`,
              backgroundColor: COLORS.raffleSoldProgress,
            }}
          />
        </div>
      </td>

      {/* Max per customer */}
      <td className="px-4 py-3 align-top text-right">
        <span style={{ color: COLORS.textPrimary }}>
          {raffle.max_tickets_per_customer ?? 3}
        </span>
      </td>

      {/* Draw date */}
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary, fontSize: "0.75rem" }}>
          {raffle.draw_date
            ? new Date(raffle.draw_date).toLocaleString("en-IE")
            : "Not set"}
        </span>
      </td>

      {/* Created */}
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary, fontSize: "0.75rem" }}>
          {new Date(raffle.created_at).toLocaleString("en-IE")}
        </span>
      </td>
    </tr>
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
      className="text-xs font-semibold px-2 py-1 rounded-full"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
    >
      {label}
    </span>
  );
}
