// app/(admin)/raffles/create/page.tsx
"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

const BUCKET_NAME = "raffle-images"; // adjust if your bucket name differs

export default function CreateRafflePage() {
  const router = useRouter();

  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [ticketPrice, setTicketPrice] = useState("");
  const [totalTickets, setTotalTickets] = useState("");
  const [drawDate, setDrawDate] = useState("");
  const [maxTicketsPerCustomer, setMaxTicketsPerCustomer] = useState("3"); // ✅ NEW

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent object URL memory leaks
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;

    // Revoke old preview before creating a new one
    if (imagePreview) URL.revokeObjectURL(imagePreview);

    setImageFile(file);

    if (file) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setError(null);

    const trimmedName = itemName.trim();
    const trimmedDesc = itemDescription.trim();
    const priceNumber = ticketPrice ? parseFloat(ticketPrice) : NaN;
    const totalTicketsNumber = totalTickets ? parseInt(totalTickets, 10) : NaN;
    const maxPerCustomerNumber = maxTicketsPerCustomer
      ? parseInt(maxTicketsPerCustomer, 10)
      : NaN;

    if (!trimmedName) {
      setError("Item name is required.");
      return;
    }

    if (!trimmedDesc) {
      setError("Item description is required.");
      return;
    }

    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      setError("Ticket price must be a positive number.");
      return;
    }

    if (Number.isNaN(totalTicketsNumber) || totalTicketsNumber <= 0) {
      setError("Total tickets must be a positive integer.");
      return;
    }

    if (
      Number.isNaN(maxPerCustomerNumber) ||
      maxPerCustomerNumber < 1 ||
      maxPerCustomerNumber > 1000
    ) {
      setError(
        "Max tickets per customer must be an integer between 1 and 1000."
      );
      return;
    }

    try {
      setSaving(true);

      // Optional: upload image first if provided
      let imageUrl: string | null = null;

      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${fileExt}`;
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
          setSaving(false);
          return;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

        imageUrl = publicUrl;
      }

      const insertPayload: {
        item_name: string;
        item_description: string;
        ticket_price: number;
        total_tickets: number;
        status: "active";
        sold_tickets: number;
        draw_date: string | null;
        item_image_url?: string | null;
        max_tickets_per_customer: number; // ✅ NEW
      } = {
        item_name: trimmedName,
        item_description: trimmedDesc,
        ticket_price: priceNumber,
        total_tickets: totalTicketsNumber,
        status: "active",
        sold_tickets: 0,
        draw_date: drawDate ? new Date(drawDate).toISOString() : null,
        max_tickets_per_customer: maxPerCustomerNumber,
      };

      if (imageUrl) {
        insertPayload.item_image_url = imageUrl;
      }

      const { data, error: insertError } = await supabase
        .from("raffles")
        .insert(insertPayload)
        .select("id")
        .single<{ id: string }>();

      if (insertError) {
        console.error("Insert raffle error:", insertError);
        throw insertError;
      }

      if (!data?.id) {
        setError("Raffle created, but could not retrieve ID.");
        setSaving(false);
        return;
      }

      router.replace(`/raffles/${data.id}`);
    } catch (err: unknown) {
      console.error("Error creating raffle:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to create raffle.");
      }
      setSaving(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Create raffle
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Set up a new SnapWin raffle, including price, tickets, optional draw
            date, image, and per-customer ticket limit.
          </p>
        </div>
      </div>

      {/* Error */}
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

      {/* Form card */}
      <div
        className="rounded-2xl p-5 border"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Item name
              </label>
              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="Example: iPhone 17 Pro Max 256GB"
                required
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Draw date (optional)
              </label>
              <input
                type="datetime-local"
                value={drawDate}
                onChange={(e) => setDrawDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              />
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Leave empty if you want to decide the draw date later.
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Item description
            </label>
            <textarea
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              rows={4}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="Describe the prize, key features, and any important rules or notes."
              required
            />
          </div>

          {/* Pricing + tickets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Ticket price (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="e.g. 4.99"
                required
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Total tickets
              </label>
              <input
                type="number"
                min="1"
                value={totalTickets}
                onChange={(e) => setTotalTickets(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="e.g. 2500"
                required
              />
            </div>

            {/* ✅ NEW */}
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Max tickets / customer
              </label>
              <input
                type="number"
                min="1"
                max="1000"
                value={maxTicketsPerCustomer}
                onChange={(e) => setMaxTicketsPerCustomer(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="e.g. 3"
                required
              />
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Default is 3. Applies per raffle.
              </p>
            </div>
          </div>

          {/* Image upload */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Raffle image (optional)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="block w-full text-xs"
                style={{ color: COLORS.textPrimary }}
              />
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Recommended: clear product photo, at least 800×600.
              </p>
            </div>

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
                  {/* Fixed frame, image always contained (no crop, no overflow) */}
                  <div className="relative w-full h-40">
                    <Image
                      src={imagePreview}
                      alt="Raffle preview"
                      fill
                      className="object-contain"
                      sizes="320px"
                      priority
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 rounded-full text-sm font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                color: COLORS.textSecondary,
                backgroundColor: COLORS.cardBg,
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-full text-sm font-medium"
              style={{
                backgroundColor: COLORS.primaryButtonBg,
                color: COLORS.primaryButtonText,
                opacity: saving ? 0.7 : 1,
                boxShadow: `0 10px 24px ${COLORS.cardShadow}`,
              }}
            >
              {saving ? "Creating..." : "Create raffle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
