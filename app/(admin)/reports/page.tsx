// app/(admin)/reports/page.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type DatasetKey = "customers" | "raffles" | "tickets" | "customer_attempts";

type ReportRow = Record<string, unknown>;

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: ReportRow[]) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeIlike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") {
    // attempt to format timestamp-ish strings
    const looksLikeDate =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ||
      /^\d{4}-\d{2}-\d{2}/.test(v);
    if (looksLikeDate) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString("en-IE");
    }
    return v;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const DATASETS: Record<
  DatasetKey,
  {
    title: string;
    table: string;
    columns: string[];
    defaults: string[];
  }
> = {
  customers: {
    title: "Customers",
    table: "customers",
    columns: [
      "id",
      "name",
      "email",
      "phone",
      "address",
      "county",
      "created_at",
      "stripe_customer_id",
      "expo_push_token",
      "avatar_url",
      "user_id",
    ],
    defaults: [
      "id",
      "name",
      "email",
      "phone",
      "county",
      "created_at",
      "expo_push_token",
    ],
  },
  raffles: {
    title: "Raffles",
    table: "raffles",
    columns: [
      "id",
      "item_name",
      "item_description",
      "status",
      "total_tickets",
      "sold_tickets",
      "ticket_price",
      "draw_date",
      "winner_id",
      "item_image_url",
      "created_at",
      "updated_at",
    ],
    defaults: [
      "id",
      "item_name",
      "status",
      "ticket_price",
      "total_tickets",
      "sold_tickets",
      "draw_date",
      "created_at",
    ],
  },
  tickets: {
    title: "Tickets / Payments",
    table: "tickets",
    columns: [
      "id",
      "raffle_id",
      "ticket_number",
      "customer_id",
      "purchased_at",
      "payment_status",
      "payment_intent_id",
      "payment_amount",
      "payment_currency",
      "payment_method",
      "payment_completed_at",
      "payment_error",
      "checkout_session_id",
      "is_winner",
      "created_at",
      "ticket_code",
    ],
    defaults: [
      "id",
      "ticket_code",
      "ticket_number",
      "raffle_id",
      "customer_id",
      "payment_status",
      "payment_amount",
      "payment_currency",
      "created_at",
    ],
  },
  customer_attempts: {
    title: "Customer Attempts",
    table: "customer_attempts",
    columns: [
      "id",
      "raffle_id",
      "customer_id",
      "passed",
      "attempted_at",
      "answers",
    ],
    defaults: ["id", "raffle_id", "customer_id", "passed", "attempted_at"],
  },
};

export default function ReportsPage() {
  const [dataset, setDataset] = useState<DatasetKey>("tickets");
  const [selectedCols, setSelectedCols] = useState<string[]>(
    DATASETS.tickets.defaults
  );

  // shared filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // customers filters
  const [customerSearch, setCustomerSearch] = useState("");
  const [county, setCounty] = useState("");
  const [hasPushToken, setHasPushToken] = useState(false);

  // raffles filters
  const [raffleStatus, setRaffleStatus] = useState("");
  const [raffleSearch, setRaffleSearch] = useState("");

  // tickets filters
  const [ticketStatus, setTicketStatus] = useState("");
  const [winnerOnly, setWinnerOnly] = useState(false);
  const [raffleId, setRaffleId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [ticketCode, setTicketCode] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // attempts filters
  const [attemptPassed, setAttemptPassed] = useState<
    "all" | "passed" | "failed"
  >("all");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);

  // Table search (client-side over loaded rows)
  const [tableSearch, setTableSearch] = useState("");

  const ds = DATASETS[dataset];

  const onDatasetChange = useCallback((next: DatasetKey) => {
    setDataset(next);
    setSelectedCols(DATASETS[next].defaults);
    setRows([]);
    setErr(null);
    setTableSearch("");
  }, []);

  const toggleCol = useCallback((c: string) => {
    setSelectedCols((prev) => {
      const set = new Set(prev);
      if (set.has(c)) set.delete(c);
      else set.add(c);
      return Array.from(set);
    });
  }, []);

  const selectAllCols = useCallback(() => {
    setSelectedCols(ds.columns.slice());
  }, [ds.columns]);

  const clearCols = useCallback(() => {
    setSelectedCols([]);
  }, []);

  const runReport = useCallback(async () => {
    setErr(null);
    setRows([]);
    if (selectedCols.length === 0) {
      setErr("Select at least one column.");
      return;
    }

    setLoading(true);
    try {
      let q = supabase.from(ds.table).select(selectedCols.join(","));

      const dateField =
        dataset === "customers"
          ? "created_at"
          : dataset === "raffles"
          ? "created_at"
          : dataset === "tickets"
          ? "created_at"
          : "attempted_at";

      if (dateFrom)
        q = q.gte(dateField, new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo)
        q = q.lte(dateField, new Date(`${dateTo}T23:59:59.999`).toISOString());

      if (dataset === "customers") {
        const s = customerSearch.trim();
        if (s) {
          const e = escapeIlike(s);
          q = q.or([`name.ilike.%${e}%`, `email.ilike.%${e}%`].join(","));
        }
        if (county.trim()) q = q.eq("county", county.trim());
        if (hasPushToken) q = q.not("expo_push_token", "is", null);
        q = q.order("created_at", { ascending: false });
      }

      if (dataset === "raffles") {
        if (raffleStatus.trim()) q = q.eq("status", raffleStatus.trim());
        if (raffleSearch.trim())
          q = q.ilike("item_name", `%${escapeIlike(raffleSearch.trim())}%`);
        q = q.order("created_at", { ascending: false });
      }

      if (dataset === "tickets") {
        if (ticketStatus.trim())
          q = q.eq("payment_status", ticketStatus.trim());
        if (winnerOnly) q = q.eq("is_winner", true);
        if (raffleId.trim()) q = q.eq("raffle_id", raffleId.trim());
        if (customerId.trim()) q = q.eq("customer_id", customerId.trim());
        if (ticketCode.trim())
          q = q.ilike("ticket_code", `%${escapeIlike(ticketCode.trim())}%`);

        const min = minAmount.trim() ? Number(minAmount.trim()) : NaN;
        const max = maxAmount.trim() ? Number(maxAmount.trim()) : NaN;
        if (!Number.isNaN(min)) q = q.gte("payment_amount", min);
        if (!Number.isNaN(max)) q = q.lte("payment_amount", max);

        q = q.order("created_at", { ascending: false });
      }

      if (dataset === "customer_attempts") {
        if (attemptPassed !== "all")
          q = q.eq("passed", attemptPassed === "passed");
        if (raffleId.trim()) q = q.eq("raffle_id", raffleId.trim());
        if (customerId.trim()) q = q.eq("customer_id", customerId.trim());
        q = q.order("attempted_at", { ascending: false });
      }

      q = q.limit(5000);

      const { data, error } = await q;
      if (error) throw error;

      const list = Array.isArray(data) ? (data as unknown[]) : [];
      const normalized: ReportRow[] = list
        .filter(
          (x): x is Record<string, unknown> =>
            typeof x === "object" && x !== null && !Array.isArray(x)
        )
        .map((x) => x);

      setRows(normalized);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Report query failed.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    dataset,
    ds.table,
    selectedCols,
    dateFrom,
    dateTo,
    customerSearch,
    county,
    hasPushToken,
    raffleStatus,
    raffleSearch,
    ticketStatus,
    winnerOnly,
    raffleId,
    customerId,
    ticketCode,
    minAmount,
    maxAmount,
    attemptPassed,
  ]);

  const exportName = useMemo(() => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `${dataset}_report_${stamp}.csv`;
  }, [dataset]);

  const filteredRows = useMemo(() => {
    const s = tableSearch.trim().toLowerCase();
    if (!s) return rows;

    return rows.filter((r) => {
      for (const c of selectedCols) {
        const txt = formatCell(r[c]).toLowerCase();
        if (txt.includes(s)) return true;
      }
      return false;
    });
  }, [rows, tableSearch, selectedCols]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Reports
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Build comprehensive reports across platform datasets with filters
            and full-column export.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={runReport}
            disabled={loading}
            className="px-4 py-2 rounded-full text-sm font-medium"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Running…" : "Run report"}
          </button>

          <button
            type="button"
            onClick={() => downloadCsv(exportName, rows)}
            disabled={rows.length === 0}
            className="px-4 py-2 rounded-full text-sm font-medium border"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.cardBg,
              color: COLORS.textSecondary,
              opacity: rows.length === 0 ? 0.6 : 1,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters + Column selection */}
      <div
        className="rounded-2xl p-5 border space-y-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Dataset
            </label>
            <select
              value={dataset}
              onChange={(e) => onDatasetChange(e.target.value as DatasetKey)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="tickets">Tickets / Payments</option>
              <option value="customers">Customers</option>
              <option value="raffles">Raffles</option>
              <option value="customer_attempts">Customer Attempts</option>
            </select>
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              {ds.title}
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Date from
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Date to
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
          </div>
        </div>

        {dataset === "customers" ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Search (name/email)
              </label>
              <input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                County (exact)
              </label>
              <input
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
            <div className="space-y-2">
              <label
                className="flex items-center gap-2 text-sm mt-7"
                style={{ color: COLORS.textSecondary }}
              >
                <input
                  type="checkbox"
                  checked={hasPushToken}
                  onChange={(e) => setHasPushToken(e.target.checked)}
                />
                Has Expo push token
              </label>
            </div>
          </div>
        ) : null}

        {dataset === "raffles" ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Status (exact)
              </label>
              <input
                value={raffleStatus}
                onChange={(e) => setRaffleStatus(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="active/soldout/drawn/cancelled"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Item name search
              </label>
              <input
                value={raffleSearch}
                onChange={(e) => setRaffleSearch(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>
          </div>
        ) : null}

        {dataset === "tickets" ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Payment status
              </label>
              <input
                value={ticketStatus}
                onChange={(e) => setTicketStatus(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="pending/completed/failed"
              />
              <label
                className="flex items-center gap-2 text-sm mt-2"
                style={{ color: COLORS.textSecondary }}
              >
                <input
                  type="checkbox"
                  checked={winnerOnly}
                  onChange={(e) => setWinnerOnly(e.target.checked)}
                />
                Winner only
              </label>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Raffle ID (exact)
              </label>
              <input
                value={raffleId}
                onChange={(e) => setRaffleId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="uuid"
              />
              <label
                className="text-sm font-medium mt-2 block"
                style={{ color: COLORS.textSecondary }}
              >
                Customer ID (exact)
              </label>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="uuid"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Ticket code contains
              </label>
              <input
                value={ticketCode}
                onChange={(e) => setTicketCode(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="SW-..."
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Amount range
              </label>
              <div className="flex gap-2">
                <input
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="min"
                />
                <input
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                  placeholder="max"
                />
              </div>
            </div>
          </div>
        ) : null}

        {dataset === "customer_attempts" ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Passed filter
              </label>
              <select
                value={attemptPassed}
                onChange={(e) =>
                  setAttemptPassed(
                    e.target.value as "all" | "passed" | "failed"
                  )
                }
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              >
                <option value="all">All</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Raffle ID (exact)
              </label>
              <input
                value={raffleId}
                onChange={(e) => setRaffleId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="uuid"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Customer ID (exact)
              </label>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="uuid"
              />
            </div>
          </div>
        ) : null}

        <div
          className="rounded-2xl p-4 border"
          style={{
            borderColor: COLORS.cardBorder,
            backgroundColor: COLORS.highlightCardBg,
          }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Columns (full table columns available)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllCols}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearCols}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: COLORS.cardBorder,
                  backgroundColor: COLORS.cardBg,
                  color: COLORS.textSecondary,
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {ds.columns.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2 text-sm"
                style={{ color: COLORS.textSecondary }}
              >
                <input
                  type="checkbox"
                  checked={selectedCols.includes(c)}
                  onChange={() => toggleCol(c)}
                />
                <span style={{ color: COLORS.textPrimary }}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        {err ? (
          <div
            className="rounded-2xl px-4 py-3 text-sm border"
            style={{
              backgroundColor: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: COLORS.error,
            }}
          >
            {err}
          </div>
        ) : null}

        <div className="text-sm" style={{ color: COLORS.textSecondary }}>
          Rows loaded:{" "}
          <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
            {rows.length}
          </span>{" "}
          (max 5000 per run)
        </div>
      </div>

      {/* Render table results */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <div
          className="px-4 py-3 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-2"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div
            className="text-sm font-semibold"
            style={{ color: COLORS.textPrimary }}
          >
            Results
          </div>

          <div className="flex gap-2 items-center">
            <input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search in loaded rows…"
              className="rounded-full px-4 py-2 text-sm border focus:outline-none focus:ring-2"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
                minWidth: 240,
              }}
            />
            <div className="text-xs" style={{ color: COLORS.textSecondary }}>
              Showing{" "}
              <strong style={{ color: COLORS.textPrimary }}>
                {filteredRows.length}
              </strong>{" "}
              {tableSearch.trim() ? (
                <span style={{ color: COLORS.textMuted }}>
                  (filtered from {rows.length})
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div
              className="text-sm font-medium"
              style={{ color: COLORS.textPrimary }}
            >
              No results yet
            </div>
            <div className="text-xs" style={{ color: COLORS.textSecondary }}>
              Run a report to generate a table preview here.
            </div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div
              className="text-sm font-medium"
              style={{ color: COLORS.textPrimary }}
            >
              No matching rows
            </div>
            <div className="text-xs" style={{ color: COLORS.textSecondary }}>
              Try clearing the search box.
            </div>
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
                  {selectedCols.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-left uppercase tracking-wide font-semibold"
                      style={{ fontSize: "0.7rem" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, idx) => (
                  <tr
                    key={idx}
                    className="border-t"
                    style={{
                      borderColor: COLORS.cardBorder,
                      backgroundColor: idx % 2 ? "#FAFAF9" : COLORS.cardBg,
                    }}
                  >
                    {selectedCols.map((c) => (
                      <td key={c} className="px-3 py-2 align-top">
                        <span style={{ color: COLORS.textPrimary }}>
                          {formatCell(r[c])}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
