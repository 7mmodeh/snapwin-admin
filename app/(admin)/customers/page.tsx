// app/(admin)/customers/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  county: string;
  created_at: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("customers")
          .select("id, name, email, phone, county, created_at")
          .order("created_at", { ascending: false });

        if (error) throw error;

        setCustomers((data ?? []) as CustomerRow[]);
      } catch (err: unknown) {
        console.error("Error loading customers:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load customers.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchCustomers();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedSearch) return customers;

    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(normalizedSearch) ||
        c.email.toLowerCase().includes(normalizedSearch) ||
        c.phone.toLowerCase().includes(normalizedSearch) ||
        c.county.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [customers, normalizedSearch]);

  return (
    <div className="space-y-6">
      {/* Header + search */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Customers
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Browse and inspect SnapWin customers and their activity.
          </p>
        </div>

        <div className="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto">
          {/* Search input */}
          <div className="relative w-full md:w-80">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, county..."
              className="w-full rounded-full px-10 py-2 text-sm border focus:outline-none focus:ring-2"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
                boxShadow: `0 10px 24px ${COLORS.cardShadow}`,
              }}
            />
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs uppercase tracking-wide"
              style={{ color: COLORS.textMuted }}
            >
              🔍
            </span>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: COLORS.textMuted }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Count summary */}
          <div className="flex gap-2 text-xs">
            <span style={{ color: COLORS.textSecondary }}>
              Total:{" "}
              <strong style={{ color: COLORS.textPrimary }}>
                {customers.length}
              </strong>
            </span>
            {normalizedSearch && (
              <span style={{ color: COLORS.textSecondary }}>
                · Matching:{" "}
                <strong style={{ color: COLORS.textPrimary }}>
                  {filtered.length}
                </strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error / loading states */}
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
          Loading customers...
        </div>
      )}

      {/* Table card */}
      {!loading && !error && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: COLORS.cardBg,
            borderColor: COLORS.cardBorder,
            boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
          }}
        >
          {filtered.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div
                className="text-sm font-medium"
                style={{ color: COLORS.textPrimary }}
              >
                No customers found
              </div>
              <div
                className="text-xs max-w-md mx-auto"
                style={{ color: COLORS.textSecondary }}
              >
                Try adjusting your search term or clear the filter to see all
                customers.
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
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>County</Th>
                    <Th>Joined</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, index) => (
                    <CustomerRowItem
                      key={c.id}
                      customer={c}
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

function CustomerRowItem({
  customer,
  striped,
}: {
  customer: CustomerRow;
  striped: boolean;
}) {
  return (
    <tr
      className="border-t transition-colors hover:bg-gray-50"
      style={{
        borderColor: COLORS.cardBorder,
        backgroundColor: striped ? "#FAFAF9" : COLORS.cardBg,
      }}
    >
      <td className="px-4 py-3 align-top">
        <Link href={`/customers/${customer.id}`}>
          <div>
            <div
              className="font-medium hover:underline"
              style={{ color: COLORS.textPrimary }}
            >
              {customer.name}
            </div>
            <div
              className="text-[0.7rem] mt-1"
              style={{ color: COLORS.textSecondary }}
            >
              ID: {customer.id}
            </div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textPrimary }}>{customer.email}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary }}>{customer.phone}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary }}>{customer.county}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <span style={{ color: COLORS.textSecondary, fontSize: "0.75rem" }}>
          {new Date(customer.created_at).toLocaleString("en-IE")}
        </span>
      </td>
    </tr>
  );
}
