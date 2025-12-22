// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { COLORS } from "@/lib/colors";
import { AnchorLink } from "./components/AnchorLink";

export const revalidate = 30;

type RaffleStatus = "active" | "soldout" | "drawn" | "cancelled";

type PublicRaffleLite = {
  id: string;
  item_name: string;
  item_description: string | null;
  item_image_url: string | null;
  ticket_price: number; // numeric in DB
  total_tickets: number;
  sold_tickets: number;
  status: RaffleStatus;
  draw_date: string | null;
  created_at: string;
};

// Raw row shape from Supabase for the landing page queries
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

type SoldRow = { sold_tickets: number | null };

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

function formatDateShort(drawDate: string | null) {
  if (!drawDate) return "To be announced";
  const d = new Date(drawDate);
  return d.toLocaleString("en-IE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default async function Home() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let latestActive: PublicRaffleLite | null = null;
  let activeRaffles: PublicRaffleLite[] = [];
  let activeCount = 0;
  let totalTicketsSoldAll = 0;
  let completedDraws = 0;

  // If env is missing, page still renders (no hard crash).
  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 1) Latest active raffles for hero + strip
    const { data: activeData } = await supabase
      .from("raffles")
      .select(
        "id,item_name,item_description,item_image_url,ticket_price,total_tickets,sold_tickets,status,draw_date,created_at"
      )
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(3);

    if (activeData && Array.isArray(activeData)) {
      activeRaffles = (activeData as RaffleRow[]).map((r) => ({
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

      latestActive = activeRaffles[0] ?? null;
    }

    // 2) Live counts (public-safe)
    const { count: activeCountResult } = await supabase
      .from("raffles")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    activeCount = activeCountResult ?? 0;

    const { count: drawnCountResult } = await supabase
      .from("raffles")
      .select("id", { count: "exact", head: true })
      .eq("status", "drawn");
    completedDraws = drawnCountResult ?? 0;

    // 3) Total tickets sold (sum in JS)
    const { data: soldRows } = await supabase
      .from("raffles")
      .select("sold_tickets")
      .limit(1000); // adjust if you expect >1000 raffles

    if (soldRows && Array.isArray(soldRows)) {
      totalTicketsSoldAll = (soldRows as SoldRow[]).reduce(
        (acc, row) => acc + safeNumber(row.sold_tickets, 0),
        0
      );
    }
  }

  // Hero mock fallback values (if no active raffle)
  const heroTitle = latestActive?.item_name ?? "Flagship smartphone";
  const heroPrice = latestActive?.ticket_price ?? 4.99;
  const heroTotal = latestActive?.total_tickets ?? 500;
  const heroSold = latestActive?.sold_tickets ?? 381;
  const heroProgress =
    heroTotal > 0 ? clamp(Math.round((heroSold / heroTotal) * 100), 0, 100) : 0;
  const heroDrawText = formatDateShort(latestActive?.draw_date ?? null);

  return (
    <main
      className="min-h-screen relative overflow-hidden"
      style={{
        background: `
          radial-gradient(circle at 0% 0%, ${COLORS.accent}22, transparent 55%),
          radial-gradient(circle at 100% 100%, ${COLORS.secondary}26, transparent 55%),
          linear-gradient(145deg, ${COLORS.screenBg} 0%, #ffffff 45%, ${COLORS.screenBg} 100%)
        `,
      }}
    >
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-soft-light"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
        }}
      />

      {/* Glow orbs */}
      <div
        className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full blur-3xl opacity-70"
        style={{ background: COLORS.secondary }}
      />
      <div
        className="pointer-events-none absolute -bottom-48 -left-40 h-96 w-96 rounded-full blur-3xl opacity-70"
        style={{ background: COLORS.accent }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-16">
        {/* Top nav */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
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
                Play smart. Win big.
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <AnchorLink
              href="#how-it-works"
              className="hover:underline"
              style={{ color: COLORS.textSecondary }}
            >
              How it works
            </AnchorLink>
            <AnchorLink
              href="#features"
              className="hover:underline"
              style={{ color: COLORS.textSecondary }}
            >
              Features
            </AnchorLink>
            <AnchorLink
              href="#faq"
              className="hover:underline"
              style={{ color: COLORS.textSecondary }}
            >
              FAQ
            </AnchorLink>
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
              style={{
                borderColor: COLORS.primary,
                color: COLORS.primary,
                backgroundColor: `${COLORS.cardBg}F2`,
              }}
            >
              Admin login
            </Link>
          </nav>
        </header>

        {/* HERO */}
        <section className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* LEFT: iPhone mockup */}
          <div className="flex justify-center lg:justify-start lg:items-center">
            {/* iPhone wrapper tuned to be a bit shorter than hero copy */}
            <div className="relative w-full max-w-[200px] sm:max-w-[240px] lg:max-w-[280px]">
              {/* Soft glow plate */}
              <div
                className="absolute -inset-10 -z-10 rounded-[3.2rem] blur-3xl opacity-80"
                style={{
                  background: `radial-gradient(circle at 20% 0%, ${COLORS.accent}, transparent 55%), radial-gradient(circle at 80% 100%, ${COLORS.secondary}, transparent 55%)`,
                }}
              />

              {/* iPhone metal frame */}
              <div
                className="relative mx-auto aspect-[9/19] rounded-[3rem] p-[3px] shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
                style={{
                  background:
                    "linear-gradient(135deg, #fdfdfd, #d7d7d7, #f9f9f9)",
                }}
              >
                {/* Side button hints */}
                <div className="absolute -right-[2px] top-24 h-14 w-[3px] rounded-l-full bg-gradient-to-b from-zinc-400 to-zinc-500" />
                <div className="absolute -left-[2px] top-20 h-8 w-[3px] rounded-r-full bg-gradient-to-b from-zinc-400 to-zinc-500" />
                <div className="absolute -left-[2px] top-32 h-8 w-[3px] rounded-r-full bg-gradient-to-b from-zinc-400 to-zinc-500" />

                {/* Inner bezel */}
                <div
                  className="relative h-full w-full rounded-[2.6rem] overflow-hidden"
                  style={{
                    background:
                      "radial-gradient(circle at 0% 0%, #1b1f2b, #020308 70%)",
                    boxShadow:
                      "inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 0 24px rgba(0,0,0,0.8)",
                  }}
                >
                  {/* Dynamic Island */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2">
                    <div className="h-5 w-28 rounded-full bg-black/85 shadow-[0_4px_12px_rgba(0,0,0,0.75)] flex items-center justify-center gap-1 px-2">
                      <span className="h-1.5 w-10 rounded-full bg-zinc-700" />
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                    </div>
                  </div>

                  {/* Glass reflection */}
                  <div
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(255,255,255,0.15), transparent 45%, transparent 65%, rgba(0,0,0,0.3))",
                    }}
                  />

                  {/* Screen content */}
                  <div className="absolute inset-0 px-4 pt-7 pb-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-[0.6rem] text-zinc-400">
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        SnapWin
                      </span>
                      <span>9:41</span>
                    </div>

                    {/* Live raffle card */}
                    {latestActive ? (
                      <Link
                        href={`/public-raffles/${latestActive.id}`}
                        className="block"
                      >
                        <div
                          className="rounded-2xl p-4 space-y-3 relative overflow-hidden"
                          style={{
                            background: `radial-gradient(circle at 0% 0%, rgba(255,255,255,0.2), transparent 55%), linear-gradient(150deg, ${COLORS.primary}, ${COLORS.secondary})`,
                            color: COLORS.textOnPrimary,
                          }}
                        >
                          <div className="absolute -bottom-8 -right-10 h-24 w-24 rounded-full opacity-30 blur-xl bg-white" />

                          <div className="flex items-center justify-between text-[0.7rem] opacity-95">
                            <span>Featured raffle</span>
                            <span>Live record</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="relative h-10 w-10 rounded-2xl bg-black/25 flex items-center justify-center overflow-hidden">
                              <Image
                                src="/snapwin-logo.svg"
                                alt="SnapWin logo"
                                fill
                                className="object-contain p-1.5"
                              />
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold leading-tight">
                                {heroTitle}
                              </p>
                              <p className="text-[0.7rem] opacity-90">
                                Live progress · Verified draw
                              </p>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[0.7rem] opacity-90">
                              <span>Tickets sold</span>
                              <span>{heroProgress}% filled</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${heroProgress}%`,
                                  backgroundColor: COLORS.raffleSoldProgress,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-[0.65rem] opacity-90">
                              <span>
                                {heroSold} / {heroTotal} tickets
                              </span>
                              <span>{formatEuro(heroPrice)} / ticket</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ) : (
                      <div
                        className="rounded-2xl p-4 space-y-2 bg-zinc-900/90 border border-white/10"
                        style={{ color: "#fff" }}
                      >
                        <div className="text-[0.75rem] font-semibold">
                          No active raffles yet
                        </div>
                        <div className="text-[0.65rem] text-zinc-400">
                          Once raffles are live, this preview will show real
                          progress and draw timing.
                        </div>
                      </div>
                    )}

                    {/* Two small tiles */}
                    <div className="grid grid-cols-2 gap-2 text-[0.65rem]">
                      <div className="rounded-xl p-2.5 bg-zinc-900/90 border border-white/8">
                        <div className="text-[0.6rem] uppercase tracking-wide text-zinc-500 mb-0.5">
                          Next draw
                        </div>
                        <div className="font-semibold text-zinc-50">
                          {heroDrawText}
                        </div>
                        <div className="mt-0.5 text-zinc-400">
                          Notification when completed.
                        </div>
                      </div>

                      <div className="rounded-xl p-2.5 bg-zinc-900/90 border border-white/8">
                        <div className="text-[0.6rem] uppercase tracking-wide text-zinc-500 mb-0.5">
                          Active raffles
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-50">
                            {activeCount}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[0.6rem]">
                            Live
                          </span>
                        </div>
                        <div className="mt-0.5 text-zinc-400">
                          Public records updated regularly.
                        </div>
                      </div>
                    </div>

                    <p className="mt-auto text-[0.6rem] text-center text-zinc-500">
                      Public data preview. Entries take place in the SnapWin
                      app.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: hero copy & CTAs */}
          <div className="space-y-8">
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[0.68rem] sm:text-xs font-medium border backdrop-blur-md shadow-sm"
              style={{
                borderColor: COLORS.accent,
                backgroundColor: `${COLORS.highlightCardBg}F2`,
                color: COLORS.textSecondary,
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full animate-pulse"
                style={{ backgroundColor: COLORS.success }}
              />
              Live public raffle records · Updated regularly
            </div>

            <div className="space-y-4">
              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
                style={{ color: COLORS.primary }}
              >
                A{" "}
                <span style={{ color: COLORS.secondary }}>
                  premium raffle experience
                </span>{" "}
                designed like a flagship app.
              </h1>
              <p
                className="text-sm sm:text-base leading-relaxed max-w-xl"
                style={{ color: COLORS.textSecondary }}
              >
                SnapWin blends luxury product design with fair, auditable raffle
                mechanics. Live ticket progress, a clean wallet for your entries
                and secure payments — packaged in a native app that feels as
                polished as the prizes you are playing for.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <button
                type="button"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold shadow-xl transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0"
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
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5"
                style={{
                  borderColor: COLORS.secondaryButtonBg,
                  color: COLORS.secondaryButtonBg,
                  backgroundColor: `${COLORS.cardBg}E6`,
                }}
              >
                Coming soon · Google Play
              </button>
            </div>

            {/* Live stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[0.75rem]">
              {[
                { label: "Active raffles", value: String(activeCount) },
                { label: "Tickets sold", value: String(totalTicketsSoldAll) },
                { label: "Completed draws", value: String(completedDraws) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl px-3 py-3 border backdrop-blur-sm"
                  style={{
                    borderColor: `${COLORS.cardBorder}B3`,
                    backgroundColor: `${COLORS.cardBg}EB`,
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

            <p className="text-xs" style={{ color: COLORS.textMuted }}>
              Download buttons will link directly to the official stores once
              SnapWin is approved and live in Ireland.
            </p>
          </div>
        </section>

        {/* Live raffles preview strip */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2
              className="text-sm sm:text-base font-semibold tracking-wide uppercase"
              style={{ color: COLORS.textSecondary }}
            >
              Live preview · Active raffle records
            </h2>

            <Link
              href="/public-raffles"
              className="hidden sm:inline-flex items-center gap-1 text-[0.75rem] underline"
              style={{ color: COLORS.textMuted }}
            >
              View all
            </Link>
          </div>

          <div className="overflow-x-auto -mx-2 px-2 pb-1">
            <div className="flex gap-4 min-w-max">
              {activeRaffles.map((raffle) => {
                const total = Math.max(raffle.total_tickets, 0);
                const sold = Math.max(raffle.sold_tickets, 0);
                const progress =
                  total > 0
                    ? clamp(Math.round((sold / total) * 100), 0, 100)
                    : 0;

                return (
                  <Link
                    key={raffle.id}
                    href={`/public-raffles/${raffle.id}`}
                    className="block"
                  >
                    <div
                      className="w-64 rounded-2xl border backdrop-blur-sm p-4 flex flex-col justify-between transition-transform duration-200 hover:-translate-y-1 hover:shadow-xl"
                      style={{
                        backgroundColor: `${COLORS.cardBg}F5`,
                        borderColor: COLORS.cardBorder,
                        boxShadow: `0 10px 28px ${COLORS.cardShadow}`,
                      }}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[0.7rem]">
                          <span
                            className="px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: COLORS.raffleTicketBg,
                              color: COLORS.raffleTicketText,
                            }}
                          >
                            Active
                          </span>
                          <span style={{ color: COLORS.textMuted }}>
                            Live record
                          </span>
                        </div>

                        <h3
                          className="text-sm font-semibold"
                          style={{ color: COLORS.textPrimary }}
                        >
                          {raffle.item_name}
                        </h3>

                        <p
                          className="text-[0.7rem]"
                          style={{ color: COLORS.textSecondary }}
                        >
                          {raffle.item_description
                            ? raffle.item_description.slice(0, 70) +
                              (raffle.item_description.length > 70 ? "…" : "")
                            : "Public raffle record with live progress and ticket caps."}
                        </p>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between text-[0.7rem]">
                          <span style={{ color: COLORS.textSecondary }}>
                            Tickets sold
                          </span>
                          <span style={{ color: COLORS.textPrimary }}>
                            {progress}% full
                          </span>
                        </div>

                        <div
                          className="w-full h-2 rounded-full overflow-hidden"
                          style={{ backgroundColor: COLORS.raffleRemaining }}
                        >
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: COLORS.raffleSoldProgress,
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[0.7rem]">
                          <span style={{ color: COLORS.textSecondary }}>
                            {sold} / {total}
                          </span>
                          <span style={{ color: COLORS.primary }}>
                            {formatEuro(raffle.ticket_price)} / ticket
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}

              {activeRaffles.length === 0 && (
                <div
                  className="w-72 rounded-2xl border p-4"
                  style={{
                    backgroundColor: `${COLORS.cardBg}F5`,
                    borderColor: COLORS.cardBorder,
                  }}
                >
                  <div
                    className="text-sm font-semibold"
                    style={{ color: COLORS.textPrimary }}
                  >
                    No active raffles yet
                  </div>
                  <div
                    className="text-xs mt-1"
                    style={{ color: COLORS.textSecondary }}
                  >
                    Once raffles are created and marked active, this section
                    will automatically populate with live records.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="sm:hidden">
            <Link
              href="/public-raffles"
              className="text-sm underline"
              style={{ color: COLORS.textMuted }}
            >
              View all active raffles
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="space-y-6 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <h2
                className="text-2xl font-bold tracking-tight"
                style={{ color: COLORS.primary }}
              >
                How SnapWin works
              </h2>
              <p
                className="text-sm max-w-xl"
                style={{ color: COLORS.textSecondary }}
              >
                A short, fair pipeline from discovering a raffle to the final
                draw animation.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              {
                step: "01",
                title: "Discover",
                body: "Browse premium raffles with transparent ticket caps, pricing and live progress.",
              },
              {
                step: "02",
                title: "Qualify",
                body: "Answer a short eligibility question set where required, then confirm your entries.",
              },
              {
                step: "03",
                title: "Enter securely",
                body: "Pay with Stripe-powered checkout and track all tickets in a clean wallet view.",
              },
              {
                step: "04",
                title: "Watch the draw",
                body: "When the countdown hits zero, draws are executed fairly and winners are notified instantly.",
              },
            ].map((item, idx) => (
              <div
                key={item.step}
                className="rounded-2xl p-4 h-full flex flex-col gap-2 border backdrop-blur-sm relative overflow-hidden"
                style={{
                  backgroundColor: `${COLORS.cardBg}F5`,
                  borderColor: COLORS.cardBorder,
                  boxShadow: `0 8px 20px ${COLORS.cardShadow}`,
                  transform: `translateY(${idx * 2}px)`,
                }}
              >
                <div
                  className="absolute -top-6 -right-10 h-16 w-16 rounded-full opacity-15"
                  style={{ backgroundColor: COLORS.accent }}
                />
                <span
                  className="text-[0.7rem] font-semibold tracking-[0.22em] uppercase"
                  style={{ color: COLORS.textMuted }}
                >
                  {item.step}
                </span>
                <h3
                  className="text-sm font-semibold"
                  style={{ color: COLORS.textPrimary }}
                >
                  {item.title}
                </h3>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: COLORS.textSecondary }}
                >
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Features + compliance */}
        <section
          id="features"
          className="grid grid-cols-1 lg:grid-cols-[1.1fr,0.9fr] gap-6 items-start"
        >
          <div className="space-y-4">
            <h2
              className="text-2xl font-bold tracking-tight"
              style={{ color: COLORS.primary }}
            >
              Transparent under the hood.
            </h2>
            <p
              className="text-sm max-w-xl"
              style={{ color: COLORS.textSecondary }}
            >
              The same engine that powers your SnapWin admin dashboard also
              drives the player experience — one source of truth for raffles,
              tickets, payments and draws.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  title: "Secure payments",
                  body: "Stripe checkout, PCI-compliant processing and modern fraud protection baked in.",
                },
                {
                  title: "Real-time data",
                  body: "Ticket sales, draw times and winner data stay in sync between the app and your admin panel.",
                },
                {
                  title: "Fair draw logic",
                  body: "Centralised draw functions with clear audit trails for every completed raffle.",
                },
                {
                  title: "Smart notifications",
                  body: "Push notifications for entries, results, support and more — all driven from your admin tools.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl p-4 h-full border relative overflow-hidden"
                  style={{
                    backgroundColor: COLORS.highlightCardBg,
                    borderColor: COLORS.cardBorder,
                  }}
                >
                  <div
                    className="absolute -bottom-5 -right-6 h-14 w-14 rounded-full opacity-10"
                    style={{ backgroundColor: COLORS.secondary }}
                  />
                  <h3
                    className="text-sm font-semibold mb-1"
                    style={{ color: COLORS.textPrimary }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: COLORS.textSecondary }}
                  >
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div
            className="rounded-2xl p-5 space-y-3 border backdrop-blur-md relative overflow-hidden"
            style={{
              backgroundColor: `${COLORS.cardBg}F8`,
              borderColor: COLORS.cardBorder,
              boxShadow: `0 12px 26px ${COLORS.cardShadow}`,
            }}
          >
            <div
              className="absolute -top-10 -left-16 h-32 w-32 rounded-full opacity-20 blur-2xl"
              style={{ backgroundColor: COLORS.accent }}
            />
            <h3
              className="text-sm font-semibold"
              style={{ color: COLORS.primary }}
            >
              Compliance & responsible play
            </h3>
            <p className="text-xs" style={{ color: COLORS.textSecondary }}>
              SnapWin is being designed around Irish regulations for games of
              chance and remote raffles. Live money raffles will only run where
              appropriate licensing and legal requirements are satisfied.
            </p>
            <ul
              className="space-y-1 text-xs"
              style={{ color: COLORS.textSecondary }}
            >
              <li>• Clear terms and published rules per raffle</li>
              <li>• Visible ticket caps and pricing</li>
              <li>• Responsible play messaging and limits</li>
            </ul>
            <p
              className="text-[0.7rem] mt-2"
              style={{ color: COLORS.textMuted }}
            >
              Until licensing is fully confirmed and active, all examples shown
              here are for product preview and testing only.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="space-y-5 pb-8">
          <h2
            className="text-2xl font-bold tracking-tight"
            style={{ color: COLORS.primary }}
          >
            Frequently asked questions
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                q: "Is SnapWin already live?",
                a: "We are actively building the mobile app and admin dashboard. Public raffles will launch once licensing and app store approvals are in place.",
              },
              {
                q: "Will I see exactly how many tickets are sold?",
                a: "Yes. Every raffle shows total tickets, sold tickets and progress bars so you always see how full the raffle is.",
              },
              {
                q: "How are payments handled?",
                a: "All payments go through Stripe, using industry-standard encryption and fraud checks. We never store your card details on our own servers.",
              },
              {
                q: "Where will I download the app?",
                a: "SnapWin will be available on the Apple App Store and Google Play Store. When live, the buttons at the top of this page will link directly to the official listings.",
              },
            ].map((item) => (
              <div
                key={item.q}
                className="rounded-2xl p-4 border"
                style={{
                  backgroundColor: COLORS.cardBg,
                  borderColor: COLORS.cardBorder,
                }}
              >
                <h3
                  className="text-sm font-semibold mb-1.5"
                  style={{ color: COLORS.textPrimary }}
                >
                  {item.q}
                </h3>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: COLORS.textSecondary }}
                >
                  {item.a}
                </p>
              </div>
            ))}
          </div>
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
              <Link
                href="/login"
                className="hover:underline"
                style={{ color: COLORS.textSecondary }}
              >
                Admin login
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
