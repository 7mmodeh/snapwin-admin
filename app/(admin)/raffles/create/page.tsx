"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";
import type { PostgrestError } from "@supabase/supabase-js";

const BUCKET_NAME = "raffle-images";

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";

type InsertedRaffle = {
  id: string;
};

function toPostgrestError(err: unknown): PostgrestError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Partial<PostgrestError>;
  if (typeof e.message === "string") return e as PostgrestError;
  return null;
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

export default function CreateRafflePage() {
  const router = useRouter();

  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [ticketPrice, setTicketPrice] = useState("5.00");
  const [totalTickets, setTotalTickets] = useState("100");
  const [drawDate, setDrawDate] = useState<string>("");
  const [maxTicketsPerCustomer, setMaxTicketsPerCustomer] = useState("3");
  const [status, setStatus] = useState<RaffleStatus>("active");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default draw_date to +7 days, 18:00 local (first mount only)
  useEffect(() => {
    if (drawDate) return;
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(18, 0, 0, 0);
    setDrawDate(toDateTimeLocalValue(d.toISOString()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const priceNumber = useMemo(() => {
    const n = parseFloat(ticketPrice);
    return Number.isFinite(n) ? n : NaN;
  }, [ticketPrice]);

  const totalTicketsNumber = useMemo(() => {
    const n = parseInt(totalTickets, 10);
    return Number.isFinite(n) ? n : NaN;
  }, [totalTickets]);

  const maxPerCustomerNumber = useMemo(() => {
    const n = parseInt(maxTicketsPerCustomer, 10);
    return Number.isFinite(n) ? n : NaN;
  }, [maxTicketsPerCustomer]);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);

    if (file) setImagePreview(URL.createObjectURL(file));
    else setImagePreview(null);
  };

  const uploadImageAndGetPublicUrl = async (
    raffleId: string
  ): Promise<string | null> => {
    if (!imageFile) return null;

    setImageUploading(true);
    try {
      const fileExt = imageFile.name.split(".").pop() || "jpg";
      const fileName = `${raffleId}-${Date.now()}.${fileExt}`;
      const filePath = `raffles/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, imageFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

      return publicUrl ?? null;
    } finally {
      setImageUploading(false);
    }
  };

  const handleCreate = async () => {
    setError(null);

    const name = itemName.trim();
    const desc = itemDescription.trim();

    if (!name) {
      setError("Item name is required.");
      return;
    }
    if (!desc) {
      setError("Item description is required.");
      return;
    }
    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      setError("Ticket price must be a positive number.");
      return;
    }
    if (!Number.isFinite(totalTicketsNumber) || totalTicketsNumber <= 0) {
      setError("Total tickets must be a positive integer.");
      return;
    }
    if (
      !Number.isFinite(maxPerCustomerNumber) ||
      maxPerCustomerNumber < 1 ||
      maxPerCustomerNumber > 1000
    ) {
      setError(
        "Max tickets per customer must be an integer between 1 and 1000."
      );
      return;
    }

    const drawIso = drawDate ? new Date(drawDate).toISOString() : null;

    try {
      setLoading(true);

      // 1) Create raffle row (minimal select returns id)
      const insertRes = await supabase
        .from("raffles")
        .insert({
          item_name: name,
          item_description: desc,
          ticket_price: priceNumber,
          total_tickets: totalTicketsNumber,
          sold_tickets: 0,
          status,
          draw_date: drawIso,
          max_tickets_per_customer: maxPerCustomerNumber,
        })
        .select("id")
        .single<InsertedRaffle>();

      if (insertRes.error) throw insertRes.error;
      const newId = insertRes.data.id;

      // 2) Optional image upload + update raffle
      if (imageFile) {
        const publicUrl = await uploadImageAndGetPublicUrl(newId);
        if (publicUrl) {
          const { error: updErr } = await supabase
            .from("raffles")
            .update({ item_image_url: publicUrl })
            .eq("id", newId);

          if (updErr) throw updErr;
        }
      }

      // ✅ Step 3 fix: go directly to Questions page
      router.replace(`/raffles/${newId}/questions`);
    } catch (err: unknown) {
      console.error("Error creating raffle:", err);
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error ? err.message : "Failed to create raffle.")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/raffles"
            className="text-sm underline"
            style={{ color: COLORS.primary }}
          >
            ← Back to raffles
          </Link>

          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight mt-2"
            style={{ color: COLORS.primary }}
          >
            Create raffle
          </h1>

          <p className="text-sm mt-1" style={{ color: COLORS.textSecondary }}>
            Create the raffle first, then configure the qualification questions.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="rounded px-4 py-3 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
        >
          {error}
        </div>
      )}

      <div
        className="rounded-2xl border p-4 md:p-6 space-y-5"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 12px 32px ${COLORS.cardShadow}`,
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="space-y-1">
              <label
                className="text-xs font-semibold"
                style={{ color: COLORS.textSecondary }}
              >
                Item name
              </label>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="Example: iPhone 15 Pro Max"
              />
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-semibold"
                style={{ color: COLORS.textSecondary }}
              >
                Item description
              </label>
              <textarea
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm min-h-[120px]"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="Describe the item, conditions, and any notes."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  className="text-xs font-semibold"
                  style={{ color: COLORS.textSecondary }}
                >
                  Ticket price (€)
                </label>
                <input
                  value={ticketPrice}
                  onChange={(e) => setTicketPrice(e.target.value)}
                  inputMode="decimal"
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-1">
                <label
                  className="text-xs font-semibold"
                  style={{ color: COLORS.textSecondary }}
                >
                  Total tickets
                </label>
                <input
                  value={totalTickets}
                  onChange={(e) => setTotalTickets(e.target.value)}
                  inputMode="numeric"
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-1">
                <label
                  className="text-xs font-semibold"
                  style={{ color: COLORS.textSecondary }}
                >
                  Draw date/time
                </label>
                <input
                  type="datetime-local"
                  value={drawDate}
                  onChange={(e) => setDrawDate(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>

              <div className="space-y-1">
                <label
                  className="text-xs font-semibold"
                  style={{ color: COLORS.textSecondary }}
                >
                  Max tickets per customer
                </label>
                <input
                  value={maxTicketsPerCustomer}
                  onChange={(e) => setMaxTicketsPerCustomer(e.target.value)}
                  inputMode="numeric"
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-semibold"
                style={{ color: COLORS.textSecondary }}
              >
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as RaffleStatus)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
              >
                <option value="active">Active</option>
                <option value="soldout">Sold out</option>
                <option value="drawn">Drawn</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <p
                className="text-[0.75rem] mt-1"
                style={{ color: COLORS.textMuted }}
              >
                Normally: create as <b>active</b>, then questions, then publish.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div
              className="rounded-xl border p-3"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.highlightCardBg,
              }}
            >
              <div
                className="text-xs font-semibold"
                style={{ color: COLORS.textSecondary }}
              >
                Raffle image (optional)
              </div>

              <div
                className="mt-2 rounded-lg overflow-hidden border"
                style={{ borderColor: COLORS.cardBorder }}
              >
                <div className="relative w-full h-40">
                  <Image
                    src={imagePreview || "/vercel.svg"}
                    alt="Preview"
                    fill
                    sizes="320px"
                    className="object-contain"
                    priority
                  />
                </div>
              </div>

              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="block w-full text-xs mt-3"
                style={{ color: COLORS.textPrimary }}
              />

              <div
                className="text-[0.7rem] mt-2"
                style={{ color: COLORS.textMuted }}
              >
                If provided, it will upload to storage and attach to the raffle
                automatically.
              </div>
            </div>

            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || imageUploading}
              className="w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{
                backgroundColor: COLORS.primaryButtonBg,
                color: COLORS.primaryButtonText,
                opacity: loading || imageUploading ? 0.7 : 1,
              }}
            >
              {loading
                ? "Creating..."
                : imageUploading
                ? "Uploading image..."
                : "Create raffle → Add questions"}
            </button>

            <div
              className="rounded-xl p-3 text-xs"
              style={{
                backgroundColor: COLORS.cardBg,
                borderColor: COLORS.cardBorder,
                borderWidth: 1,
                color: COLORS.textSecondary,
              }}
            >
              After creation, you’ll be taken directly to the raffle’s{" "}
              <b>Questions</b> page.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
