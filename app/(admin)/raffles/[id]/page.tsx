"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";
import type {
  PostgrestError,
  RealtimeChannel,
  PostgrestSingleResponse,
  PostgrestResponse,
} from "@supabase/supabase-js";

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
  winning_ticket_id: string | null;
  winning_ticket_number: number | null;
  item_image_url: string | null;
  created_at: string;
  updated_at: string | null;
  max_tickets_per_customer: number;
};

type TicketRow = {
  id: string;
  ticket_code: string | null;
  ticket_number: number;
  customer_id: string;
  payment_status: "pending" | "completed" | "failed" | string;
  is_winner: boolean | null;
  purchased_at: string | null;
  created_at: string | null;
  payment_amount: number | null;
};

type WinnerCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  county: string | null;
};

type DrawWinnerRpcResult = {
  winner_id: string | null;
  winning_ticket_id: string | null;
  winning_ticket_number: number | null;
};

type TicketsStatusFilter =
  | "all"
  | "completed"
  | "pending"
  | "failed"
  | "winner";

const RAFFLE_SELECT =
  "id, item_name, item_description, status, total_tickets, sold_tickets, ticket_price, draw_date, winner_id, winning_ticket_id, winning_ticket_number, item_image_url, created_at, updated_at, max_tickets_per_customer";

const TICKETS_SELECT =
  "id, raffle_id, ticket_code, ticket_number, customer_id, payment_status, is_winner, purchased_at, created_at, payment_amount";

function buildQuery(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") s.set(k, v);
  });
  const q = s.toString();
  return q ? `?${q}` : "";
}

function shortId(id: string | null | undefined) {
  if (!id) return "—";
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no-op
  }
}

function isDrawWinnerRpcResult(v: unknown): v is DrawWinnerRpcResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const okWinner =
    o.winner_id === null ||
    typeof o.winner_id === "string" ||
    o.winner_id === undefined;
  const okTicketId =
    o.winning_ticket_id === null ||
    typeof o.winning_ticket_id === "string" ||
    o.winning_ticket_id === undefined;
  const okTicketNum =
    o.winning_ticket_number === null ||
    typeof o.winning_ticket_number === "number" ||
    o.winning_ticket_number === undefined;
  return okWinner && okTicketId && okTicketNum;
}

function toPostgrestError(err: unknown): PostgrestError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Partial<PostgrestError>;
  if (typeof e.message === "string") return e as PostgrestError;
  return null;
}

function coerceNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "-";
  return amount.toFixed(2);
}

export default function RaffleDetailPage() {
  const params = useParams();
  const router = useRouter();

  const rawId = (params as { id?: string | string[] }).id;
  const raffleId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [raffle, setRaffle] = useState<RaffleDetail | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [winner, setWinner] = useState<WinnerCustomer | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [itemNameDraft, setItemNameDraft] = useState("");
  const [itemDescriptionDraft, setItemDescriptionDraft] = useState("");
  const [ticketPriceDraft, setTicketPriceDraft] = useState("");
  const [totalTicketsDraft, setTotalTicketsDraft] = useState("");
  const [statusDraft, setStatusDraft] =
    useState<RaffleDetail["status"]>("active");
  const [drawDateDraft, setDrawDateDraft] = useState<string>("");
  const [maxTicketsPerCustomerDraft, setMaxTicketsPerCustomerDraft] =
    useState<string>("3");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageSaving, setImageSaving] = useState(false);

  // Ticket UX controls
  const [ticketFilter, setTicketFilter] = useState<TicketsStatusFilter>("all");
  const [ticketSearch, setTicketSearch] = useState("");

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const clearRealtimeTimer = useCallback(() => {
    if (realtimeRefreshTimerRef.current) {
      window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
    }
  }, []);

  const fetchDetail = useCallback(async () => {
    try {
      if (!raffleId) return;

      setLoading(true);
      setError(null);
      setSuccess(null);

      const raffleReq = supabase
        .from("raffles")
        .select(RAFFLE_SELECT)
        .eq("id", raffleId)
        .maybeSingle();

      const ticketsReq = supabase
        .from("tickets")
        .select(TICKETS_SELECT)
        .eq("raffle_id", raffleId)
        .order("created_at", { ascending: true });

      const [raffleRes, ticketsRes] = (await Promise.all([
        raffleReq,
        ticketsReq,
      ])) as [PostgrestSingleResponse<unknown>, PostgrestResponse<unknown>];

      if (raffleRes.error) throw raffleRes.error;
      if (!raffleRes.data) {
        setError("Raffle not found.");
        setRaffle(null);
        setTickets([]);
        setWinner(null);
        return;
      }

      if (ticketsRes.error) throw ticketsRes.error;

      const raffleData = raffleRes.data as RaffleDetail;

      const rawTickets: unknown = ticketsRes.data ?? [];
      const ticketsArray: unknown[] = Array.isArray(rawTickets)
        ? rawTickets
        : [];

      const normalizedTickets: TicketRow[] = ticketsArray.map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          ticket_code:
            o.ticket_code == null ? null : String(o.ticket_code ?? null),
          ticket_number:
            typeof o.ticket_number === "number"
              ? o.ticket_number
              : parseInt(String(o.ticket_number ?? "0"), 10) || 0,
          customer_id: String(o.customer_id ?? ""),
          payment_status: String(o.payment_status ?? ""),
          is_winner:
            typeof o.is_winner === "boolean"
              ? o.is_winner
              : (o.is_winner as boolean | null) ?? null,
          purchased_at: o.purchased_at == null ? null : String(o.purchased_at),
          created_at: o.created_at == null ? null : String(o.created_at),
          payment_amount: coerceNumber(o.payment_amount),
        };
      });

      setRaffle(raffleData);
      setTickets(normalizedTickets);

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

      setMaxTicketsPerCustomerDraft(
        String(raffleData.max_tickets_per_customer ?? 3)
      );

      if (raffleData.winner_id) {
        const winnerRes = await supabase
          .from("customers")
          .select("id, name, email, phone, county")
          .eq("id", raffleData.winner_id)
          .maybeSingle();

        if (!winnerRes.error && winnerRes.data) {
          setWinner(winnerRes.data as WinnerCustomer);
        } else {
          setWinner(null);
        }
      } else {
        setWinner(null);
      }
    } catch (err: unknown) {
      console.error("Error loading raffle detail:", err);
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error
            ? err.message
            : "Failed to load raffle details.")
      );
    } finally {
      setLoading(false);
    }
  }, [raffleId]);

  const scheduleRefresh = useCallback(() => {
    clearRealtimeTimer();
    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      fetchDetail();
    }, 350);
  }, [clearRealtimeTimer, fetchDetail]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (!raffleId) return;

    const ticketsChannel: RealtimeChannel = supabase
      .channel(`admin-raffle-${raffleId}-tickets`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `raffle_id=eq.${raffleId}`,
        },
        () => scheduleRefresh()
      )
      .subscribe();

    const rafflesChannel: RealtimeChannel = supabase
      .channel(`admin-raffle-${raffleId}-raffles`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "raffles",
          filter: `id=eq.${raffleId}`,
        },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      clearRealtimeTimer();
      supabase.removeChannel(ticketsChannel);
      supabase.removeChannel(rafflesChannel);
    };
  }, [raffleId, scheduleRefresh, clearRealtimeTimer]);

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

  const filteredTickets = useMemo(() => {
    let res = [...tickets];

    if (ticketFilter === "winner") res = res.filter((t) => !!t.is_winner);
    else if (ticketFilter !== "all")
      res = res.filter((t) => String(t.payment_status) === ticketFilter);

    const q = ticketSearch.trim().toLowerCase();
    if (q) {
      res = res.filter((t) => {
        const code = (t.ticket_code ?? "").toLowerCase();
        const id = t.id.toLowerCase();
        const cust = t.customer_id.toLowerCase();
        return (
          code.includes(q) ||
          id.includes(q) ||
          cust.includes(q) ||
          String(t.ticket_number).includes(q)
        );
      });
    }

    return res;
  }, [tickets, ticketFilter, ticketSearch]);

  const handleSave = async () => {
    if (!raffle) return;

    const priceNumber = ticketPriceDraft ? parseFloat(ticketPriceDraft) : NaN;
    const totalTicketsNumber = totalTicketsDraft
      ? parseInt(totalTicketsDraft, 10)
      : NaN;

    const maxPerCustomerNumber = maxTicketsPerCustomerDraft
      ? parseInt(maxTicketsPerCustomerDraft, 10)
      : NaN;

    if (!Number.isNaN(priceNumber) && priceNumber <= 0) {
      setError("Ticket price must be a positive number.");
      return;
    }

    if (!Number.isNaN(totalTicketsNumber) && totalTicketsNumber <= 0) {
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
        max_tickets_per_customer: number;
      } = {
        status: statusDraft,
        draw_date: drawDateDraft ? new Date(drawDateDraft).toISOString() : null,
        max_tickets_per_customer: maxPerCustomerNumber,
      };

      if (itemNameDraft.trim()) updatePayload.item_name = itemNameDraft.trim();
      if (itemDescriptionDraft.trim())
        updatePayload.item_description = itemDescriptionDraft.trim();
      if (!Number.isNaN(priceNumber)) updatePayload.ticket_price = priceNumber;
      if (!Number.isNaN(totalTicketsNumber))
        updatePayload.total_tickets = totalTicketsNumber;

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
              max_tickets_per_customer: updatePayload.max_tickets_per_customer,
              updated_at: new Date().toISOString(),
            }
          : prev
      );

      setSuccess("Raffle updated successfully.");
    } catch (err: unknown) {
      console.error("Error updating raffle:", err);
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error ? err.message : "Failed to update raffle.")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDrawWinner = async () => {
    if (!raffleId || !raffle) return;

    try {
      setDrawing(true);
      setError(null);
      setSuccess(null);

      const rpcRes = await supabase.rpc("draw_raffle_winner", {
        p_raffle_id: raffleId,
      });

      if (rpcRes.error) throw rpcRes.error;

      const raw: unknown = rpcRes.data;

      const parsed: DrawWinnerRpcResult | null = Array.isArray(raw)
        ? raw.length && isDrawWinnerRpcResult(raw[0])
          ? (raw[0] as DrawWinnerRpcResult)
          : null
        : isDrawWinnerRpcResult(raw)
        ? (raw as DrawWinnerRpcResult)
        : null;

      if (!parsed) {
        throw new Error("Draw completed but returned an unexpected payload.");
      }

      const nextWinnerId = parsed.winner_id ?? null;
      const nextWinningTicketId = parsed.winning_ticket_id ?? null;
      const nextWinningTicketNumber = parsed.winning_ticket_number ?? null;

      setRaffle((prev) =>
        prev
          ? {
              ...prev,
              status: "drawn",
              winner_id: nextWinnerId,
              winning_ticket_id: nextWinningTicketId,
              winning_ticket_number: nextWinningTicketNumber,
              draw_date: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : prev
      );

      if (nextWinnerId) {
        const winnerRes = await supabase
          .from("customers")
          .select("id, name, email, phone, county")
          .eq("id", nextWinnerId)
          .maybeSingle();

        if (!winnerRes.error && winnerRes.data) {
          setWinner(winnerRes.data as WinnerCustomer);
        } else {
          setWinner(null);
        }
      } else {
        setWinner(null);
      }

      const ticketsRes = await supabase
        .from("tickets")
        .select(TICKETS_SELECT)
        .eq("raffle_id", raffleId)
        .order("created_at", { ascending: true });

      if (ticketsRes.error) throw ticketsRes.error;

      const rawTickets: unknown = ticketsRes.data ?? [];
      const ticketsArray: unknown[] = Array.isArray(rawTickets)
        ? rawTickets
        : [];
      const normalizedTickets: TicketRow[] = ticketsArray.map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          ticket_code: o.ticket_code == null ? null : String(o.ticket_code),
          ticket_number:
            typeof o.ticket_number === "number"
              ? o.ticket_number
              : parseInt(String(o.ticket_number ?? "0"), 10) || 0,
          customer_id: String(o.customer_id ?? ""),
          payment_status: String(o.payment_status ?? ""),
          is_winner:
            typeof o.is_winner === "boolean"
              ? o.is_winner
              : (o.is_winner as boolean | null) ?? null,
          purchased_at: o.purchased_at == null ? null : String(o.purchased_at),
          created_at: o.created_at == null ? null : String(o.created_at),
          payment_amount: coerceNumber(o.payment_amount),
        };
      });

      setTickets(normalizedTickets);

      setSuccess(
        nextWinningTicketNumber != null
          ? `Winner drawn successfully. Winning ticket #${nextWinningTicketNumber}.`
          : "Winner drawn successfully."
      );
    } catch (err: unknown) {
      console.error("Error drawing winner:", err);
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error ? err.message : "Failed to draw winner.")
      );
    } finally {
      setDrawing(false);
    }
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;

    if (imagePreview) URL.revokeObjectURL(imagePreview);

    setImageFile(file);

    if (file) setImagePreview(URL.createObjectURL(file));
    else setImagePreview(null);
  };

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
      const pe = toPostgrestError(err);
      setError(
        pe?.message ??
          (err instanceof Error ? err.message : "Failed to upload new image.")
      );
    } finally {
      setImageSaving(false);
    }
  };

  const handleExportTickets = () => {
    if (!tickets.length || !raffle) return;

    const header = [
      "ticket_code",
      "ticket_number",
      "payment_status",
      "is_winner",
      "purchased_at",
      "created_at",
      "payment_amount",
      "customer_id",
      "ticket_id",
    ];

    const rows = tickets.map((t) => [
      t.ticket_code ?? "",
      t.ticket_number,
      t.payment_status,
      t.is_winner ? "true" : "false",
      t.purchased_at ? new Date(t.purchased_at).toISOString() : "",
      t.created_at ? new Date(t.created_at).toISOString() : "",
      t.payment_amount ?? "",
      t.customer_id,
      t.id,
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

  const currentImageSrc = raffle.item_image_url || "/vercel.svg";
  const canDraw =
    raffle.status === "soldout" &&
    (raffle.sold_tickets ?? 0) >= raffle.total_tickets;
  const alreadyDrawn = raffle.status === "drawn";

  return (
    <div className="space-y-6">
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

          <p className="text-xs mt-2" style={{ color: COLORS.textMuted }}>
            Max tickets per customer:{" "}
            <span style={{ color: COLORS.textSecondary, fontWeight: 700 }}>
              {raffle.max_tickets_per_customer ?? 3}
            </span>
          </p>

          {alreadyDrawn && (
            <p className="text-xs mt-2" style={{ color: COLORS.textMuted }}>
              Winning ticket:{" "}
              <span style={{ color: COLORS.textSecondary, fontWeight: 700 }}>
                {raffle.winning_ticket_number != null
                  ? `#${raffle.winning_ticket_number}`
                  : "-"}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-col items-start md:items-end gap-2">
          <StatusBadge status={raffle.status} />
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: COLORS.textSecondary }}>
              Raffle ID: {raffle.id}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(raffle.id)}
              className="text-[0.7rem] underline"
              style={{ color: COLORS.primary }}
            >
              Copy
            </button>
          </div>

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
            <Link
              href={`/tickets${buildQuery({ raffle_id: raffle.id })}`}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.highlightCardBg,
                color: COLORS.textPrimary,
              }}
              title="Open tickets list filtered by this raffle"
            >
              Open in Tickets
            </Link>
          </div>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
          <StatCard
            label="Max per customer"
            value={`${raffle.max_tickets_per_customer ?? 3}`}
            sub="Per raffle purchase limit"
          />
          {alreadyDrawn && (
            <StatCard
              label="Winning ticket"
              value={
                raffle.winning_ticket_number != null
                  ? `#${raffle.winning_ticket_number}`
                  : "-"
              }
              sub="Stored on raffle"
            />
          )}
        </div>

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

          <div className="space-y-2 text-sm">
            <div
              className="font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Draw winner
            </div>

            {alreadyDrawn ? (
              <div
                className="rounded px-3 py-2 text-xs"
                style={{
                  backgroundColor: COLORS.highlightCardBg,
                  borderColor: COLORS.cardBorder,
                  borderWidth: 1,
                  color: COLORS.textSecondary,
                }}
              >
                This raffle is already drawn.
                <div className="mt-1" style={{ color: COLORS.textMuted }}>
                  Winning ticket:{" "}
                  {raffle.winning_ticket_number != null
                    ? `#${raffle.winning_ticket_number}`
                    : "-"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: COLORS.textMuted }}>
                  Allowed only when status is <b>sold out</b> and all tickets
                  are sold. This action is idempotent and will not re-draw once
                  completed.
                </p>

                <button
                  type="button"
                  onClick={handleDrawWinner}
                  disabled={!canDraw || drawing}
                  className="w-full rounded py-2 text-xs font-medium"
                  style={{
                    backgroundColor: COLORS.primaryButtonBg,
                    color: COLORS.primaryButtonText,
                    opacity: !canDraw || drawing ? 0.5 : 1,
                  }}
                >
                  {drawing ? "Drawing..." : "Draw winner now"}
                </button>

                {!canDraw && (
                  <p
                    className="text-[0.7rem]"
                    style={{ color: COLORS.textMuted }}
                  >
                    To draw: status must be <b>sold out</b> and sold tickets
                    must equal total tickets.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <div
              className="font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Raffle image
            </div>

            <div
              className="rounded border overflow-hidden"
              style={{
                borderColor: COLORS.cardBorder,
                backgroundColor: COLORS.highlightCardBg,
              }}
            >
              <div className="relative w-full h-40">
                <Image
                  src={currentImageSrc}
                  alt={raffle.item_name}
                  fill
                  sizes="(max-width: 1024px) 100vw, 320px"
                  className="object-contain"
                  priority
                />
              </div>
            </div>

            {imagePreview && (
              <div className="space-y-2">
                <div
                  className="text-xs font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  New image preview
                </div>

                <div
                  className="border rounded-lg overflow-hidden"
                  style={{
                    borderColor: COLORS.cardBorder,
                    backgroundColor: COLORS.highlightCardBg,
                  }}
                >
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

          <button
            type="button"
            onClick={fetchDetail}
            className="w-full rounded py-2 text-xs font-medium border"
            style={{
              borderColor: COLORS.cardBorder,
              backgroundColor: COLORS.cardBg,
              color: COLORS.primary,
            }}
          >
            Refresh data
          </button>

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
            <div className="flex items-center gap-2">
              <Link
                href={`/customers/${winner.id}`}
                className="font-semibold underline"
                style={{ color: COLORS.primary }}
                title="Open customer"
              >
                {winner.name}
              </Link>
              <span style={{ color: COLORS.textSecondary }}>
                ({winner.email})
              </span>
            </div>

            <div style={{ color: COLORS.textSecondary }}>
              {winner.phone && <>Phone: {winner.phone} · </>}
              {winner.county && <>County: {winner.county}</>}
            </div>

            <div className="text-xs mt-2" style={{ color: COLORS.textMuted }}>
              Winning ticket:{" "}
              <span style={{ color: COLORS.textSecondary, fontWeight: 700 }}>
                {raffle.winning_ticket_number != null
                  ? `#${raffle.winning_ticket_number}`
                  : "-"}
              </span>
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
          className="p-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3"
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
              Click a row to drill into Tickets list. Use quick actions for
              Customer/Raffle navigation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              value={ticketFilter}
              onChange={(e) =>
                setTicketFilter(e.target.value as TicketsStatusFilter)
              }
              className="border rounded-xl px-3 py-2 text-xs"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              title="Filter tickets"
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="winner">Winners</option>
            </select>

            <input
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
              placeholder="Search code, ticket #, customer id…"
              className="border rounded-xl px-3 py-2 text-xs w-full sm:w-72"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            />

            <button
              type="button"
              onClick={handleExportTickets}
              disabled={!tickets.length}
              className="px-3 py-2 rounded-xl text-xs font-semibold border"
              style={{
                backgroundColor: COLORS.secondaryButtonBg,
                color: COLORS.secondaryButtonText,
                borderColor: COLORS.cardBorder,
                opacity: tickets.length ? 1 : 0.5,
              }}
            >
              Export tickets CSV
            </button>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="p-4" style={{ color: COLORS.textMuted }}>
            No tickets match the current filters.
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
                  <th className="px-3 py-2 text-left">Ticket</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Winner</th>
                  <th className="px-3 py-2 text-left">Purchased</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((t) => {
                  const rowHref = `/tickets${buildQuery({
                    raffle_id: raffle.id,
                    customer_id: t.customer_id,
                    status:
                      t.payment_status === "completed" ||
                      t.payment_status === "pending" ||
                      t.payment_status === "failed"
                        ? String(t.payment_status)
                        : undefined,
                  })}`;

                  return (
                    <tr
                      key={t.id}
                      className="border-t hover:bg-gray-50 transition-colors"
                      style={{ borderColor: COLORS.cardBorder }}
                    >
                      <td className="px-3 py-2 align-top">
                        <Link
                          href={rowHref}
                          className="block rounded-lg p-2 -m-2"
                          style={{ color: COLORS.textPrimary }}
                          title="Open Tickets list with filters"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              #{t.ticket_number}
                            </span>
                            {t.ticket_code ? (
                              <span
                                className="px-2 py-0.5 rounded-full text-[0.65rem] font-semibold border"
                                style={{
                                  backgroundColor: COLORS.tabBg,
                                  borderColor: COLORS.tabBorder,
                                  color: COLORS.textSecondary,
                                }}
                              >
                                {t.ticket_code}
                              </span>
                            ) : (
                              <span
                                className="text-[0.7rem]"
                                style={{ color: COLORS.textMuted }}
                              >
                                No code
                              </span>
                            )}
                          </div>

                          <div
                            className="mt-1 text-[0.7rem]"
                            style={{ color: COLORS.textMuted }}
                          >
                            Ticket ID: {shortId(t.id)}
                          </div>
                        </Link>
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
                          <span style={{ color: COLORS.textMuted }}>—</span>
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
                        <div
                          style={{
                            color: COLORS.textMuted,
                            fontSize: "0.7rem",
                          }}
                        >
                          Created:{" "}
                          {t.created_at
                            ? new Date(t.created_at).toLocaleString("en-IE")
                            : "-"}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top text-right">
                        <span style={{ color: COLORS.textPrimary }}>
                          {t.payment_amount != null
                            ? `€${formatAmount(t.payment_amount)}`
                            : "-"}
                        </span>
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/customers/${t.customer_id}`}
                            className="underline text-[0.75rem]"
                            style={{ color: COLORS.primary }}
                            title="Open customer"
                          >
                            {shortId(t.customer_id)}
                          </Link>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(t.customer_id)}
                            className="text-[0.7rem] underline"
                            style={{ color: COLORS.textSecondary }}
                            title="Copy customer ID"
                          >
                            Copy
                          </button>
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/tickets${buildQuery({
                              raffle_id: raffle.id,
                              customer_id: t.customer_id,
                            })}`}
                            className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border"
                            style={{
                              borderColor: COLORS.cardBorder,
                              backgroundColor: COLORS.highlightCardBg,
                              color: COLORS.textPrimary,
                            }}
                            title="Open in tickets list"
                          >
                            View
                          </Link>

                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(t.ticket_code ?? t.id)
                            }
                            className="px-2 py-1 rounded-lg text-[0.7rem] font-semibold border"
                            style={{
                              borderColor: COLORS.cardBorder,
                              backgroundColor: COLORS.tabBg,
                              color: COLORS.textPrimary,
                            }}
                            title="Copy ticket code (or ticket id)"
                          >
                            Copy
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
  let label: string = String(status ?? "");

  if (status === "completed") {
    bg = COLORS.success;
    label = "Completed";
  } else if (status === "pending") {
    bg = COLORS.warning;
    label = "Pending";
  } else if (status === "failed") {
    bg = COLORS.error;
    label = "Failed";
  } else if (!label) {
    label = "Unknown";
  }

  return (
    <span
      className="px-2 py-1 rounded-full text-[0.65rem] font-semibold"
      style={{ backgroundColor: bg, color: COLORS.textOnPrimary }}
      title={`payment_status: ${label}`}
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
