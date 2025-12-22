// app/(admin)/raffles/[id]/edit/page.tsx
"use client";

import { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

const BUCKET_NAME = "raffle-images"; // adjust if your bucket name differs

type RaffleDetail = {
  id: string;
  item_name: string;
  item_description: string;
  ticket_price: number | string;
  total_tickets: number;
  sold_tickets: number | null;
  draw_date: string | null;
  item_image_url: string | null;
};

export default function EditRafflePage() {
  const params = useParams();
  const router = useRouter();

  // Normalize id so it's always a single string
  const rawId = (params as { id?: string | string[] }).id;
  const raffleId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [raffle, setRaffle] = useState<RaffleDetail | null>(null);

  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [ticketPrice, setTicketPrice] = useState("");
  const [totalTickets, setTotalTickets] = useState("");
  const [drawDate, setDrawDate] = useState("");

  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRaffle = async () => {
      if (!raffleId) return;

      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("raffles")
          .select(
            "id, item_name, item_description, ticket_price, total_tickets, sold_tickets, draw_date, item_image_url"
          )
          .eq("id", raffleId)
          .maybeSingle<RaffleDetail>();

        if (error) throw error;
        if (!data) {
          setError("Raffle not found.");
          setLoading(false);
          return;
        }

        setRaffle(data);

        setItemName(data.item_name);
        setItemDescription(data.item_description);
        setTicketPrice(
          typeof data.ticket_price === "number"
            ? data.ticket_price.toString()
            : data.ticket_price
        );
        setTotalTickets(data.total_tickets.toString());
        setDrawDate(
          data.draw_date
            ? new Date(data.draw_date).toISOString().slice(0, 16)
            : ""
        );
        setCurrentImageUrl(data.item_image_url);
        setImagePreview(null);
      } catch (err: unknown) {
        console.error("Error loading raffle:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load raffle.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRaffle();
  }, [raffleId]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!raffle || saving) return;

    setError(null);

    const trimmedName = itemName.trim();
    const trimmedDesc = itemDescription.trim();
    const priceNumber = ticketPrice ? parseFloat(ticketPrice) : NaN;
    const totalTicketsNumber = totalTickets ? parseInt(totalTickets, 10) : NaN;

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

    const sold = raffle.sold_tickets ?? 0;
    if (totalTicketsNumber < sold) {
      setError(`Total tickets cannot be lower than sold tickets (${sold}).`);
      return;
    }

    try {
      setSaving(true);

      let imageUrl: string | null = currentImageUrl ?? null;

      // If a new image is selected, upload it and replace the URL.
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

      const updatePayload: {
        item_name: string;
        item_description: string;
        ticket_price: number;
        total_tickets: number;
        draw_date: string | null;
        item_image_url?: string | null;
        updated_at: string;
      } = {
        item_name: trimmedName,
        item_description: trimmedDesc,
        ticket_price: priceNumber,
        total_tickets: totalTicketsNumber,
        draw_date: drawDate ? new Date(drawDate).toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      updatePayload.item_image_url = imageUrl;

      const { error: updateError } = await supabase
        .from("raffles")
        .update(updatePayload)
        .eq("id", raffle.id);

      if (updateError) {
        console.error("Update raffle error:", updateError);
        throw updateError;
      }

      router.replace(`/raffles/${raffle.id}`);
    } catch (err: unknown) {
      console.error("Error updating raffle:", err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update raffle.");
      }
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: COLORS.textSecondary }}
      >
        Loading raffle...
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
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{
            backgroundColor: "#FEF2F2",
            borderColor: "#FCA5A5",
            color: COLORS.error,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!raffle) return null;

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
            ← Back to raffle
          </button>
          <h1
            className="text-3xl font-bold tracking-tight mb-1"
            style={{ color: COLORS.primary }}
          >
            Edit raffle
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            Update prize information, pricing, ticket count, draw date and
            image.
          </p>
        </div>
      </div>

      {/* Error (while editing) */}
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
                Change the draw date or clear it to decide later.
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
              required
            />
          </div>

          {/* Pricing + tickets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                required
              />
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Sold tickets: {raffle.sold_tickets ?? 0}. You cannot set the
                total below this value.
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
                Raffle image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="block w-full text-xs"
                style={{ color: COLORS.textPrimary }}
              />
              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Upload a new image to replace the current one, or leave it empty
                to keep the existing image.
              </p>
            </div>

            <div className="space-y-2">
              <div
                className="text-xs font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Current / new preview
              </div>
              <div className="border rounded-lg overflow-hidden max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview || currentImageUrl || "/vercel.svg"}
                  alt="Raffle preview"
                  className="w-full h-40 object-cover"
                />
              </div>
            </div>
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
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
