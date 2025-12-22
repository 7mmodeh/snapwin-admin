// app/public-raffles/[id]/page.tsx
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { COLORS } from "@/lib/colors";

export const revalidate = 30;

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";

type PublicRaffle = {
  id: string;
  item_name: string;
  item_description: string;
  item_image_url: string | null;
  ticket_price: number; // numeric in DB
  total_tickets: number;
  sold_tickets: number;
  status: RaffleStatus;
  draw_date: string | null;
  winner_id: string | null;
  created_at: string;
};

function safeNumber(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatEuro(n: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function formatDateTime(drawDate: string | null) {
  if (!drawDate) return "To be announced";
  const d = new Date(drawDate);
  return d.toLocaleString("en-IE", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: RaffleStatus) {
  switch (status) {
    case "active":
      return "Live";
    case "soldout":
      return "Sold out";
    case "drawn":
      return "Draw completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

function statusPillColors(status: RaffleStatus) {
  switch (status) {
    case "active":
      return { bg: "rgba(16,185,129,0.14)", fg: "rgb(16,185,129)" }; // emerald
    case "soldout":
      return { bg: "rgba(59,130,246,0.14)", fg: "rgb(59,130,246)" }; // blue
    case "drawn":
      return { bg: "rgba(168,85,247,0.14)", fg: "rgb(168,85,247)" }; // purple
    case "cancelled":
      return { bg: "rgba(239,68,68,0.14)", fg: "rgb(239,68,68)" }; // red
    default:
      return { bg: "rgba(0,0,0,0.08)", fg: "rgba(0,0,0,0.7)" };
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PublicRafflePage({
  params,
}: {
  // ✅ Next.js 16 often provides params as a Promise in the App Router
  params: Promise<{ id?: string }>;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail clearly in dev if env is missing (prevents mystery 404)
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    );
  }

  // ✅ Await params (fixes “valid id but still 404” in Next 16)
  const { id: raw } = await params;
  const id = raw ? decodeURIComponent(raw) : "";

  if (!id || !UUID_REGEX.test(id)) notFound();

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Fetch exactly the columns you have in your schema
  const { data, error } = await supabase
    .from("raffles")
    .select(
      "id,item_name,item_description,item_image_url,ticket_price,total_tickets,sold_tickets,status,draw_date,winner_id,created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();

  const raffle: PublicRaffle = {
    id: String(data.id),
    item_name: String(data.item_name),
    item_description: String(data.item_description),
    item_image_url: data.item_image_url ? String(data.item_image_url) : null,
    ticket_price: safeNumber(data.ticket_price, 0),
    total_tickets: safeNumber(data.total_tickets, 0),
    sold_tickets: safeNumber(data.sold_tickets, 0),
    status: (data.status as RaffleStatus) ?? "active",
    draw_date: data.draw_date ? String(data.draw_date) : null,
    winner_id: data.winner_id ? String(data.winner_id) : null,
    created_at: String(data.created_at),
  };

  const total = Math.max(raffle.total_tickets, 0);
  const sold = Math.max(raffle.sold_tickets, 0);
  const remaining = Math.max(total - sold, 0);
  const progress =
    total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0;

  const pill = statusPillColors(raffle.status);

  return (
    <main
      className="min-h-screen relative overflow-hidden"
      style={{
        background: `
          radial-gradient(circle at 0% 0%, ${COLORS.accent}18, transparent 55%),
          radial-gradient(circle at 100% 100%, ${COLORS.secondary}20, transparent 55%),
          linear-gradient(145deg, ${COLORS.screenBg} 0%, #ffffff 45%, ${COLORS.screenBg} 100%)
        `,
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-15 mix-blend-soft-light"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
        }}
      />

      {/* Glow orbs */}
      <div
        className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full blur-3xl opacity-60"
        style={{ background: COLORS.secondary }}
      />
      <div
        className="pointer-events-none absolute -bottom-48 -left-40 h-96 w-96 rounded-full blur-3xl opacity-60"
        style={{ background: COLORS.accent }}
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-9 w-9 sm:h-10 sm:w-10 rounded-2xl overflow-hidden border border-white/60 shadow-md shadow-black/10 bg-white/70 backdrop-blur">
              <Image
                src="/snapwin-icon.png"
                alt="SnapWin icon"
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="flex flex-col">
              <span
                className="text-lg sm:text-xl font-semibold tracking-tight"
                style={{ color: COLORS.primary }}
              >
                SnapWin
              </span>
              <span
                className="text-[0.7rem] sm:text-xs"
                style={{ color: COLORS.textSecondary }}
              >
                Public raffle record
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <span
              className="px-3 py-1 rounded-full text-xs font-semibold border"
              style={{
                backgroundColor: pill.bg,
                color: pill.fg,
                borderColor: "rgba(0,0,0,0.06)",
              }}
            >
              {statusLabel(raffle.status)}
            </span>

            <Link
              href="/"
              className="hidden sm:inline-flex px-3 py-1 rounded-full text-xs font-medium border transition-all hover:-translate-y-0.5"
              style={{
                borderColor: COLORS.cardBorder,
                color: COLORS.textSecondary,
                backgroundColor: `${COLORS.cardBg}E6`,
              }}
            >
              Back to home
            </Link>
          </div>
        </header>

        {/* Main content */}
        <section className="grid grid-cols-1 lg:grid-cols-[1fr,0.75fr] gap-6 items-start">
          {/* Left: Primary card */}
          <div
            className="rounded-3xl border p-5 sm:p-7 space-y-6 backdrop-blur-sm"
            style={{
              backgroundColor: `${COLORS.cardBg}F6`,
              borderColor: COLORS.cardBorder,
              boxShadow: `0 20px 40px ${COLORS.cardShadow}`,
            }}
          >
            {/* Title + image */}
            <div className="flex flex-col sm:flex-row gap-5 sm:items-start">
              <div className="flex-1 space-y-2">
                <h1
                  className="text-2xl sm:text-3xl font-bold tracking-tight"
                  style={{ color: COLORS.primary }}
                >
                  {raffle.item_name}
                </h1>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: COLORS.textSecondary }}
                >
                  {raffle.item_description}
                </p>
              </div>

              {raffle.item_image_url ? (
                <div
                  className="relative h-32 w-32 sm:h-36 sm:w-36 rounded-2xl overflow-hidden border bg-white/80"
                  style={{ borderColor: COLORS.cardBorder }}
                >
                  <Image
                    src={raffle.item_image_url}
                    alt={raffle.item_name}
                    fill
                    className="object-contain p-2"
                  />
                </div>
              ) : (
                <div
                  className="h-32 w-32 sm:h-36 sm:w-36 rounded-2xl border flex items-center justify-center text-xs"
                  style={{
                    borderColor: COLORS.cardBorder,
                    color: COLORS.textMuted,
                    backgroundColor: `${COLORS.highlightCardBg}CC`,
                  }}
                >
                  No image
                </div>
              )}
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: COLORS.textSecondary }}>
                  Tickets sold
                </span>
                <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
                  {progress}% full
                </span>
              </div>

              <div
                className="w-full h-2.5 rounded-full overflow-hidden"
                style={{ backgroundColor: COLORS.raffleRemaining }}
              >
                <div
                  className="h-2.5 rounded-full"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: COLORS.raffleSoldProgress,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span style={{ color: COLORS.textSecondary }}>
                  {sold} / {total} tickets
                </span>
                <span style={{ color: COLORS.textSecondary }}>
                  Remaining:{" "}
                  <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
                    {remaining}
                  </span>
                </span>
              </div>
            </div>

            {/* Key facts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  label: "Ticket price",
                  value: formatEuro(raffle.ticket_price),
                },
                { label: "Draw time", value: formatDateTime(raffle.draw_date) },
                {
                  label: "Created",
                  value: new Date(raffle.created_at).toLocaleDateString(
                    "en-IE"
                  ),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl p-4 border"
                  style={{
                    backgroundColor: `${COLORS.cardBg}EB`,
                    borderColor: COLORS.cardBorder,
                  }}
                >
                  <div
                    className="text-[0.65rem] uppercase tracking-[0.22em] mb-1"
                    style={{ color: COLORS.textMuted }}
                  >
                    {item.label}
                  </div>
                  <div
                    className="text-sm font-semibold"
                    style={{ color: COLORS.textPrimary }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Compliance note */}
            <div
              className="rounded-2xl p-4 border"
              style={{
                backgroundColor: `${COLORS.highlightCardBg}CC`,
                borderColor: COLORS.cardBorder,
              }}
            >
              <p
                className="text-xs leading-relaxed"
                style={{ color: COLORS.textSecondary }}
              >
                This page displays a public snapshot of raffle records (ticket
                caps, pricing, progress and draw time). Entries are completed
                inside the SnapWin mobile app once licensing and store approvals
                are active.
              </p>
            </div>
          </div>

          {/* Right: CTA / actions */}
          <aside className="space-y-4">
            <div
              className="rounded-3xl border p-5 sm:p-6 space-y-4 backdrop-blur-sm"
              style={{
                backgroundColor: `${COLORS.cardBg}F4`,
                borderColor: COLORS.cardBorder,
                boxShadow: `0 14px 28px ${COLORS.cardShadow}`,
              }}
            >
              <div className="space-y-1">
                <h2
                  className="text-lg font-semibold tracking-tight"
                  style={{ color: COLORS.primary }}
                >
                  Enter this raffle in the app
                </h2>
                <p className="text-sm" style={{ color: COLORS.textSecondary }}>
                  SnapWin runs entries securely with Stripe checkout and a
                  verified draw engine.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold shadow-xl transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
                  style={{
                    background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
                    color: COLORS.textOnPrimary,
                    boxShadow: `0 20px 45px ${COLORS.cardShadow}`,
                  }}
                >
                  Coming soon · App Store
                </button>

                <button
                  type="button"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    borderColor: COLORS.secondaryButtonBg,
                    color: COLORS.secondaryButtonBg,
                    backgroundColor: `${COLORS.cardBg}E6`,
                  }}
                >
                  Coming soon · Google Play
                </button>
              </div>

              <p className="text-xs" style={{ color: COLORS.textMuted }}>
                Until licensing is fully confirmed and active, this page is
                provided for product preview and transparency.
              </p>
            </div>

            <div
              className="rounded-3xl border p-5 space-y-3"
              style={{
                backgroundColor: `${COLORS.cardBg}F4`,
                borderColor: COLORS.cardBorder,
              }}
            >
              <h3
                className="text-sm font-semibold"
                style={{ color: COLORS.textPrimary }}
              >
                Quick links
              </h3>

              <div className="flex flex-col gap-2 text-sm">
                <Link
                  href="/terms"
                  className="hover:underline"
                  style={{ color: COLORS.textSecondary }}
                >
                  Terms &amp; Conditions
                </Link>
                <Link
                  href="/privacy"
                  className="hover:underline"
                  style={{ color: COLORS.textSecondary }}
                >
                  Privacy Policy
                </Link>
                <Link
                  href="/responsible-play"
                  className="hover:underline"
                  style={{ color: COLORS.textSecondary }}
                >
                  Responsible Play
                </Link>
              </div>
            </div>
          </aside>
        </section>

        {/* Footer */}
        <footer
          className="border-t pt-4 pb-6"
          style={{ borderColor: COLORS.cardBorder }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <span style={{ color: COLORS.textMuted }}>
              © {new Date().getFullYear()} SnapWin. All rights reserved.
            </span>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/terms"
                className="hover:underline"
                style={{ color: COLORS.textSecondary }}
              >
                Terms &amp; Conditions
              </Link>
              <Link
                href="/privacy"
                className="hover:underline"
                style={{ color: COLORS.textSecondary }}
              >
                Privacy Policy
              </Link>
              <Link
                href="/responsible-play"
                className="hover:underline"
                style={{ color: COLORS.textSecondary }}
              >
                Responsible Play
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
