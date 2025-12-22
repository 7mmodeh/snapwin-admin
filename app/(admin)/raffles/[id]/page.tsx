// app/(admin)/raffles/[id]/page.tsx
"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

const BUCKET_NAME = "raffle-images";

type RaffleDetail = {
  id: string;
  item_name: string;
  item_description: string;
  status: "active" | "soldout" | "drawn" | "cancelled";
  total_tickets: number;
  sold_tickets: number | null;
  ticket_price: number | string;
  draw_date: string | null;
  winner_id: string | null;
  item_image_url: string | null;
  created_at: string;
  updated_at: string | null;
};

type TicketRow = {
  id: string;
  ticket_number: number;
  customer_id: string;
  payment_status: "pending" | "completed" | "failed";
  is_winner: boolean;
  purchased_at: string | null;
  payment_amount: string | number | null;
};

type WinnerCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  county: string | null;
};

const STATUS_OPTIONS: Array<RaffleDetail["status"]> = [
  "active",
  "soldout",
  "drawn",
  "cancelled",
];

export default function RaffleDetailPage() {
  const params = useParams();
  const router = useRouter();

  // Normalize id
  const rawId = (params as { id?: string | string[] }).id;
  const raffleId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [raffle, setRaffle] = useState<RaffleDetail | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [winner, setWinner] = useState<WinnerCustomer | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editable drafts
  const [itemNameDraft, setItemNameDraft] = useState("");
  const [itemDescriptionDraft, setItemDescriptionDraft] = useState("");
  const [ticketPriceDraft, setTicketPriceDraft] = useState("");
  const [totalTicketsDraft, setTotalTicketsDraft] = useState("");
  const [statusDraft, setStatusDraft] =
    useState<RaffleDetail["status"]>("active");
  const [drawDateDraft, setDrawDateDraft] = useState<string>("");

  // Image replace state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageSaving, setImageSaving] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        if (!raffleId) return;
        setLoading(true);
        setError(null);
        setSuccess(null);

        const [raffleRes, ticketsRes] = await Promise.all([
          supabase
            .from("raffles")
            .select(
              "id, item_name, item_description, status, total_tickets, sold_tickets, ticket_price, draw_date, winner_id, item_image_url, created_at, updated_at"
            )
            .eq("id", raffleId)
            .maybeSingle<RaffleDetail>(),
          supabase
            .from("tickets")
            .select(
              "id, ticket_number, customer_id, payment_status, is_winner, purchased_at, payment_amount"
            )
            .eq("raffle_id", raffleId)
            .order("ticket_number", { ascending: true }),
        ]);

        if (raffleRes.error) throw raffleRes.error;
        if (!raffleRes.data) {
          setError("Raffle not found.");
          setLoading(false);
          return;
        }
        if (ticketsRes.error) throw ticketsRes.error;

        const raffleData = raffleRes.data;
        const ticketsData = (ticketsRes.data ?? []) as TicketRow[];

        setRaffle(raffleData);
        setTickets(ticketsData);

        // init drafts
        setItemNameDraft(raffleData.item_name);
        setItemDescriptionDraft(raffleData.item_description);

        const price =
          typeof raffleData.ticket_price === "number"
            ? raffleData.ticket_price
            : parseFloat(raffleData.ticket_price as string);
        setTicketPriceDraft(Number.isNaN(price) ? "" : price.toFixed(2));
        setTotalTicketsDraft(raffleData.total_tickets.toString());

        setStatusDraft(raffleData.status);
        setDrawDateDraft(
          raffleData.draw_date ? toDateTimeLocalValue(raffleData.draw_date) : ""
        );

        // load winner details if any
        if (raffleData.winner_id) {
          const winnerRes = await supabase
            .from("customers")
            .select("id, name, email, phone, county")
            .eq("id", raffleData.winner_id)
            .maybeSingle<WinnerCustomer>();

          if (!winnerRes.error && winnerRes.data) {
            setWinner(winnerRes.data);
          }
        }
      } catch (err: unknown) {
        console.error("Error loading raffle detail:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load raffle details.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [raffleId]);

  const stats = useMemo(() => {
    if (!raffle) {
      return {
        sold: 0,
        total: 0,
        soldPercent: 0,
        revenue: 0,
        completedPayments: 0,
        failedPayments: 0,
      };
    }

    const sold = raffle.sold_tickets ?? 0;
    const total = raffle.total_tickets;
    const soldPercent = total > 0 ? Math.round((sold / total) * 100) : 0;

    const price =
      typeof raffle.ticket_price === "number"
        ? raffle.ticket_price
        : parseFloat(raffle.ticket_price as string);
    const revenue = Number.isNaN(price) ? 0 : price * sold;

    const completedPayments = tickets.filter(
      (t) => t.payment_status === "completed"
    ).length;

    const failedPayments = tickets.filter(
      (t) => t.payment_status === "failed"
    ).length;

    return {
      sold,
      total,
      soldPercent,
      revenue,
      completedPayments,
      failedPayments,
    };
  }, [raffle, tickets]);

  const handleSave = async () => {
    if (!raffle) return;

    const priceNumber = ticketPriceDraft ? parseFloat(ticketPriceDraft) : NaN;
    const totalTicketsNumber = totalTicketsDraft
      ? parseInt(totalTicketsDraft, 10)
      : NaN;

    if (!Number.isNaN(priceNumber) && priceNumber <= 0) {
      setError("Ticket price must be a positive number.");
      return;
    }

    if (!Number.isNaN(totalTicketsNumber) && totalTicketsNumber <= 0) {
      setError("Total tickets must be a positive integer.");
      return;
    }

    // ensure total_tickets is not less than sold_tickets
    if (!Number.isNaN(totalTicketsNumber)) {
      const sold = raffle.sold_tickets ?? 0;
      if (totalTicketsNumber < sold) {
        setError(`Total tickets cannot be lower than sold tickets (${sold}).`);
        return;
      }
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updatePayload: {
        item_name?: string;
        item_description?: string;
        ticket_price?: number;
        total_tickets?: number;
        status: RaffleDetail["status"];
        draw_date: string | null;
      } = {
        status: statusDraft,
        draw_date: drawDateDraft ? new Date(drawDateDraft).toISOString() : null,
      };

      if (itemNameDraft.trim()) {
        updatePayload.item_name = itemNameDraft.trim();
      }
      if (itemDescriptionDraft.trim()) {
        updatePayload.item_description = itemDescriptionDraft.trim();
      }
      if (!Number.isNaN(priceNumber)) {
        updatePayload.ticket_price = priceNumber;
      }
      if (!Number.isNaN(totalTicketsNumber)) {
        updatePayload.total_tickets = totalTicketsNumber;
      }

      const { error: updateError } = await supabase
        .from("raffles")
        .update(updatePayload)
        .eq("id", raffle.id);

      if (updateError) throw updateError;

      setRaffle((prev) =>
        prev
          ? {
              ...prev,
              item_name: updatePayload.item_name ?? prev.item_name,
              item_description:
                updatePayload.item_description ?? prev.item_description,
              ticket_price: updatePayload.ticket_price ?? prev.ticket_price,
              total_tickets: updatePayload.total_tickets ?? prev.total_tickets,
              status: updatePayload.status,
              draw_date: updatePayload.draw_date,
              updated_at: new Date().toISOString(),
            }
          : prev
      );

      setSuccess("Raffle updated successfully.");
    } catch (err: unknown) {
      console.error("Error updating raffle:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update raffle.");
      }
    } finally {
      setSaving(false);
    }
  };

  // image file selection
  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);

    if (file) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  // upload new image and update raffle.item_image_url
  const handleImageUpload = async () => {
    if (!raffle || !imageFile) return;

    try {
      setImageSaving(true);
      setError(null);
      setSuccess(null);

      const fileExt = imageFile.name.split(".").pop() || "jpg";
      const fileName = `${raffle.id}-${Date.now()}.${fileExt}`;
      const filePath = `raffles/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, imageFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Image upload error:", uploadError);
        setError("Image upload failed. Please try again.");
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("raffles")
        .update({ item_image_url: publicUrl })
        .eq("id", raffle.id);

      if (updateError) {
        console.error("Error updating raffle image URL:", updateError);
        setError("Image saved, but raffle record update failed.");
        return;
      }

      setRaffle((prev) =>
        prev ? { ...prev, item_image_url: publicUrl } : prev
      );
      setImageFile(null);
      setImagePreview(null);
      setSuccess("Raffle image updated successfully.");
    } catch (err: unknown) {
      console.error("Error uploading new image:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to upload new image.");
      }
    } finally {
      setImageSaving(false);
    }
  };

  // Export tickets CSV
  const handleExportTickets = () => {
    if (!tickets.length || !raffle) return;

    const header = [
      "ticket_number",
      "payment_status",
      "is_winner",
      "purchased_at",
      "payment_amount",
      "customer_id",
    ];

    const rows = tickets.map((t) => [
      t.ticket_number,
      t.payment_status,
      t.is_winner ? "true" : "false",
      t.purchased_at ? new Date(t.purchased_at).toISOString() : "",
      t.payment_amount ?? "",
      t.customer_id,
    ]);

    const csvContent =
      [header, ...rows]
        .map((row) =>
          row
            .map((value) => {
              const str = String(value ?? "");
              const escaped = str.replace(/"/g, '""');
              return `"${escaped}"`;
            })
            .join(",")
        )
        .join("\n") + "\n";

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = raffle.item_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    link.href = url;
    link.download = `snapwin-raffle-${safeName || raffle.id}-tickets.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading raffle details...
      </div>
    );
  }

  if (error && !raffle) {
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

  if (!raffle) return null;

  return (
    <div className="space-y-6">
      {/* Top header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm underline mb-2"
            style={{ color: COLORS.primary }}
          >
            ← Back to raffles
          </button>
          <h1
            className="text-3xl font-bold mb-1"
            style={{ color: COLORS.primary }}
          >
            {raffle.item_name}
          </h1>
          <p style={{ color: COLORS.textSecondary }}>
            {raffle.item_description}
          </p>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <StatusBadge status={raffle.status} />
          <span className="text-xs" style={{ color: COLORS.textSecondary }}>
            Raffle ID: {raffle.id}
          </span>
          <div className="flex flex-wrap gap-2 mt-1">
            <Link
              href={`/raffles/${raffle.id}/edit`}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: COLORS.primaryButtonBg,
                color: COLORS.primaryButtonText,
                boxShadow: `0 8px 20px ${COLORS.cardShadow}`,
              }}
            >
              Edit raffle
            </Link>
            <Link
              href={`/raffles/${raffle.id}/questions`}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.cardBg,
                color: COLORS.primary,
              }}
            >
              Manage questions
            </Link>
          </div>
        </div>
      </div>

      {/* Success / error messages */}
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

      {/* Stats + controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick stats */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Tickets sold"
            value={`${stats.sold} / ${stats.total}`}
            sub={`${stats.soldPercent}% sold`}
          />
          <StatCard
            label="Revenue"
            value={`€${stats.revenue.toFixed(2)}`}
            sub="Ticket price × sold"
          />
          <StatCard
            label="Completed payments"
            value={stats.completedPayments.toString()}
            sub="Tickets fully paid"
          />
          <StatCard
            label="Failed payments"
            value={stats.failedPayments.toString()}
            sub="Payment failed or cancelled"
          />
        </div>

        {/* Controls */}
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
            Raffle controls
          </h2>

          {/* Image section */}
          <div className="space-y-2 text-sm">
            <div
              className="font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Raffle image
            </div>

            {raffle.item_image_url ? (
              <div className="relative w-full h-40 rounded border overflow-hidden mb-2">
                <Image
                  src={raffle.item_image_url}
                  alt={raffle.item_name}
                  fill
                  sizes="(max-width: 768px) 200px, 300px"
                  className="object-cover"
                />
              </div>
            ) : (
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                No image set for this raffle yet.
              </p>
            )}

            {imagePreview && (
              <div className="space-y-2">
                <div
                  className="text-xs font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Preview
                </div>

                <div
                  className="border rounded-lg overflow-hidden max-w-xs"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.highlightCardBg,
                  }}
                >
                  <div className="w-full h-40 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="Raffle preview"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="block w-full text-xs"
                style={{ color: COLORS.textPrimary }}
              />
              <p className="text-[0.7rem]" style={{ color: COLORS.textMuted }}>
                Choose a new image and click &quot;Upload new image&quot; to
                update this raffle.
              </p>
            </div>

            <button
              type="button"
              onClick={handleImageUpload}
              disabled={!imageFile || imageSaving}
              className="w-full rounded py-2 text-xs font-medium"
              style={{
                backgroundColor: COLORS.secondaryButtonBg,
                color: COLORS.secondaryButtonText,
                opacity: !imageFile || imageSaving ? 0.5 : 1,
              }}
            >
              {imageSaving ? "Uploading..." : "Upload new image"}
            </button>
          </div>

          {/* Editable core fields */}
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label
                className="font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Item name
              </label>
              <input
                type="text"
                value={itemNameDraft}
                onChange={(e) => setItemNameDraft(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>

            <div className="space-y-1">
              <label
                className="font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Item description
              </label>
              <textarea
                value={itemDescriptionDraft}
                onChange={(e) => setItemDescriptionDraft(e.target.value)}
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Ticket price (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={ticketPriceDraft}
                  onChange={(e) => setTicketPriceDraft(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-1">
                <label
                  className="font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Total tickets
                </label>
                <input
                  type="number"
                  min="1"
                  value={totalTicketsDraft}
                  onChange={(e) => setTotalTicketsDraft(e.target.value)}
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

          {/* Status select */}
          <div className="space-y-1">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Status
            </label>
            <select
              value={statusDraft}
              onChange={(e) =>
                setStatusDraft(e.target.value as RaffleDetail["status"])
              }
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "active"
                    ? "Active"
                    : s === "soldout"
                    ? "Sold out"
                    : s === "drawn"
                    ? "Drawn"
                    : "Cancelled"}
                </option>
              ))}
            </select>
          </div>

          {/* Draw date */}
          <div className="space-y-1">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Draw date
            </label>
            <input
              type="datetime-local"
              value={drawDateDraft}
              onChange={(e) => setDrawDateDraft(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />
            <p className="text-xs" style={{ color: COLORS.textMuted }}>
              Leave empty to clear draw date.
            </p>
          </div>

          {/* Draw actions link */}
          <div className="space-y-1">
            <span
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Draw actions
            </span>
            <a
              href={`/draw/${raffle.id}`}
              className="text-sm underline"
              style={{ color: COLORS.primary }}
            >
              Open draw tool (to be wired)
            </a>
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded py-2 text-sm font-medium"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {/* Winner panel */}
      <div
        className="rounded-lg p-4"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          borderWidth: 1,
        }}
      >
        <h2
          className="text-lg font-semibold mb-2"
          style={{ color: COLORS.textPrimary }}
        >
          Winner
        </h2>
        {raffle.status !== "drawn" || !raffle.winner_id ? (
          <p className="text-sm" style={{ color: COLORS.textMuted }}>
            No winner has been set yet.
          </p>
        ) : winner ? (
          <div className="space-y-1 text-sm">
            <div>
              <span
                className="font-medium"
                style={{ color: COLORS.textPrimary }}
              >
                {winner.name}
              </span>{" "}
              <span style={{ color: COLORS.textSecondary }}>
                ({winner.email})
              </span>
            </div>
            <div style={{ color: COLORS.textSecondary }}>
              {winner.phone && <>Phone: {winner.phone} · </>}
              {winner.county && <>County: {winner.county}</>}
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: COLORS.textMuted }}>
            Winner ID is set, but customer details could not be loaded.
          </p>
        )}
      </div>

      {/* Tickets table + export */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          borderWidth: 1,
        }}
      >
        <div
          className="p-4 border-b flex items-center justify-between gap-2"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: COLORS.textPrimary }}
            >
              Tickets
            </h2>
            <p className="text-xs mt-1" style={{ color: COLORS.textSecondary }}>
              All tickets for this raffle (includes pending, completed and
              failed).
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportTickets}
            disabled={!tickets.length}
            className="px-3 py-2 rounded text-xs font-medium"
            style={{
              backgroundColor: COLORS.secondaryButtonBg,
              color: COLORS.secondaryButtonText,
              opacity: tickets.length ? 1 : 0.5,
            }}
          >
            Export tickets CSV
          </button>
        </div>

        {tickets.length === 0 ? (
          <div className="p-4" style={{ color: COLORS.textMuted }}>
            No tickets found for this raffle.
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
                  <th className="px-3 py-2 text-left">Ticket #</th>
                  <th className="px-3 py-2 text-left">Payment status</th>
                  <th className="px-3 py-2 text-left">Winner</th>
                  <th className="px-3 py-2 text-left">Purchased at</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Customer ID</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    <td className="px-3 py-2 align-top">
                      <span style={{ color: COLORS.textPrimary }}>
                        {t.ticket_number}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <TicketStatusBadge status={t.payment_status} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {t.is_winner ? (
                        <span
                          className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
                          style={{
                            backgroundColor: COLORS.success,
                            color: COLORS.textOnPrimary,
                          }}
                        >
                          Winner
                        </span>
                      ) : (
                        <span
                          style={{
                            color: COLORS.textMuted,
                            fontSize: "0.75rem",
                          }}
                        >
                          -
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        style={{
                          color: COLORS.textSecondary,
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.purchased_at
                          ? new Date(t.purchased_at).toLocaleString("en-IE")
                          : "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <span style={{ color: COLORS.textPrimary }}>
                        {t.payment_amount != null
                          ? `€${formatAmount(t.payment_amount)}`
                          : "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        style={{
                          color: COLORS.textSecondary,
                          fontSize: "0.75rem",
                        }}
                      >
                        {t.customer_id}
                      </span>
                    </td>
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col"
      style={{
        backgroundColor: COLORS.cardBg,
        borderColor: COLORS.cardBorder,
        borderWidth: 1,
        boxShadow: `0 8px 20px ${COLORS.cardShadow}`,
      }}
    >
      <span
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: COLORS.textSecondary }}
      >
        {label}
      </span>
      <span
        className="text-xl font-bold mt-1"
        style={{ color: COLORS.primary }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-xs mt-1" style={{ color: COLORS.textMuted }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RaffleDetail["status"] }) {
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

function TicketStatusBadge({
  status,
}: {
  status: TicketRow["payment_status"];
}) {
  let bg = COLORS.info;
  let label: string = status;

  if (status === "completed") {
    bg = COLORS.success;
    label = "Completed";
  } else if (status === "pending") {
    bg = COLORS.warning;
    label = "Pending";
  } else if (status === "failed") {
    bg = COLORS.error;
    label = "Failed";
  }

  return (
    <span
      className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
    >
      {label}
    </span>
  );
}

function toDateTimeLocalValue(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, "0");

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatAmount(amount: string | number): string {
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(2);
}
