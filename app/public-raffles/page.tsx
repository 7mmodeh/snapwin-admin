// app/public-raffles/page.tsx
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { COLORS } from "@/lib/colors";

export const revalidate = 30;

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";

type PublicRaffleLite = {
  id: string;
  item_name: string;
  item_description: string | null;
  item_image_url: string | null;
  ticket_price: number;
  total_tickets: number;
  sold_tickets: number;
  status: RaffleStatus;
  draw_date: string | null;
  created_at: string;
};

type RaffleRow = {
  id: string;
  item_name: string;
  item_description: string | null;
  item_image_url: string | null;
  ticket_price: number;
  total_tickets: number;
  sold_tickets: number;
  status: RaffleStatus;
  draw_date: string | null;
  created_at: string;
};

function safeNumber(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatEuro(n: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
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
      return { bg: "rgba(16,185,129,0.14)", fg: "rgb(16,185,129)" };
    case "soldout":
      return { bg: "rgba(59,130,246,0.14)", fg: "rgb(59,130,246)" };
    case "drawn":
      return { bg: "rgba(168,85,247,0.14)", fg: "rgb(168,85,247)" };
    case "cancelled":
      return { bg: "rgba(239,68,68,0.14)", fg: "rgb(239,68,68)" };
    default:
      return { bg: "rgba(0,0,0,0.08)", fg: "rgba(0,0,0,0.7)" };
  }
}

export default async function PublicRafflesIndexPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let raffles: PublicRaffleLite[] = [];

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data } = await supabase
      .from("raffles")
      .select(
        "id,item_name,item_description,item_image_url,ticket_price,total_tickets,sold_tickets,status,draw_date,created_at"
      )
      .in("status", ["active", "soldout", "drawn"])
      .order("created_at", { ascending: false })
      .limit(30);

    if (data && Array.isArray(data)) {
      raffles = (data as RaffleRow[]).map((r) => ({
        id: r.id,
        item_name: r.item_name,
        item_description: r.item_description,
        item_image_url: r.item_image_url,
        ticket_price: safeNumber(r.ticket_price, 0),
        total_tickets: safeNumber(r.total_tickets, 0),
        sold_tickets: safeNumber(r.sold_tickets, 0),
        status: r.status ?? "active",
        draw_date: r.draw_date,
        created_at: r.created_at,
      }));
    }
  }

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

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
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
                Public raffle records
              </span>
            </div>
          </Link>

          <Link
            href="/"
            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            style={{
              borderColor: COLORS.cardBorder,
              color: COLORS.textSecondary,
              backgroundColor: `${COLORS.cardBg}F2`,
            }}
          >
            Back to home
          </Link>
        </header>

        <section className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: COLORS.primary }}
          >
            Public raffles
          </h1>
          <p className="text-sm" style={{ color: COLORS.textSecondary }}>
            A live, public snapshot of raffle records — ticket caps, progress,
            pricing and draw timing. Click any raffle to view its record page.
          </p>
        </section>

        {/* Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {raffles.map((r) => {
            const total = Math.max(r.total_tickets, 0);
            const sold = Math.max(r.sold_tickets, 0);
            const progress =
              total > 0 ? clamp(Math.round((sold / total) * 100), 0, 100) : 0;

            const pill = statusPillColors(r.status);

            return (
              <Link
                key={r.id}
                href={`/public-raffles/${r.id}`}
                className="block"
              >
                <div
                  className="rounded-3xl border p-5 backdrop-blur-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-xl"
                  style={{
                    backgroundColor: `${COLORS.cardBg}F5`,
                    borderColor: COLORS.cardBorder,
                    boxShadow: `0 10px 28px ${COLORS.cardShadow}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[0.7rem] font-semibold border"
                        style={{
                          backgroundColor: pill.bg,
                          color: pill.fg,
                          borderColor: "rgba(0,0,0,0.06)",
                        }}
                      >
                        {statusLabel(r.status)}
                      </div>

                      <h3
                        className="text-base font-semibold leading-snug"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {r.item_name}
                      </h3>
                      <p
                        className="text-xs leading-relaxed"
                        style={{ color: COLORS.textSecondary }}
                      >
                        {r.item_description
                          ? r.item_description.slice(0, 90) +
                            (r.item_description.length > 90 ? "…" : "")
                          : "Public record with live progress and ticket caps."}
                      </p>
                    </div>

                    {r.item_image_url ? (
                      <div
                        className="relative h-14 w-14 rounded-2xl overflow-hidden border bg-white/80 shrink-0"
                        style={{ borderColor: COLORS.cardBorder }}
                      >
                        <Image
                          src={r.item_image_url}
                          alt={r.item_name}
                          fill
                          className="object-contain p-2"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: COLORS.textSecondary }}>
                        Tickets sold
                      </span>
                      <span
                        style={{ color: COLORS.textPrimary, fontWeight: 600 }}
                      >
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
                        {sold} / {total}
                      </span>
                      <span style={{ color: COLORS.primary, fontWeight: 600 }}>
                        {formatEuro(r.ticket_price)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}

          {raffles.length === 0 && (
            <div
              className="rounded-3xl border p-6"
              style={{
                backgroundColor: `${COLORS.cardBg}F5`,
                borderColor: COLORS.cardBorder,
              }}
            >
              <div
                className="text-sm font-semibold"
                style={{ color: COLORS.textPrimary }}
              >
                No records available yet
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: COLORS.textSecondary }}
              >
                Once raffles exist in the database (and RLS allows public read),
                this page will populate automatically.
              </div>
            </div>
          )}
        </section>

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
