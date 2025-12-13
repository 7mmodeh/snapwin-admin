// app/responsible-play/page.tsx
import { COLORS } from "@/lib/colors";

export default function ResponsiblePlayPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: COLORS.screenBg }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <header className="space-y-1">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: COLORS.primary }}
          >
            Responsible Play
          </h1>
          <p className="text-xs" style={{ color: COLORS.textMuted }}>
            Looking after our players is core to how SnapWin is designed.
          </p>
        </header>

        <section className="space-y-3 text-sm leading-relaxed">
          <p style={{ color: COLORS.textSecondary }}>
            SnapWin is built to provide a fun, premium experience for games of
            chance and raffles. We also take responsible play seriously. Raffles
            and games of chance should always be enjoyable and should never
            cause financial or personal harm.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            This page explains our approach to responsible play and offers
            guidance if you are concerned about your own play or that of someone
            close to you.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            1. Play within your means
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            Only spend what you can comfortably afford to lose. Raffles should
            never be used as a way to solve financial difficulties, pay bills or
            cover essential living costs.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            Before entering, consider setting a personal limit on how much you
            are prepared to spend over a given period and stick to it.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            2. Warning signs
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            You may wish to review your play if you notice any of the following:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              Spending more time or money on raffles than you planned.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Chasing losses or increasing stakes to try to recover previous
              spend.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Hiding your participation from friends or family.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Using raffles to escape stress, anxiety or other personal
              problems.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Feeling irritated or distressed when you cannot take part.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            3. Our product design choices
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            SnapWin&apos;s product decisions are made with responsible play in
            mind, including:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              Clear display of ticket caps, pricing and progress for each
              raffle.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Respectful messaging for non-winning results, without pressure to
              immediately re-enter.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Tools in the roadmap to allow players to manage limits or pause
              participation, where supported by regulation and platform rules.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            4. Age restrictions
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            SnapWin is only intended for users aged 18 or over. We may use
            verification checks where required to help prevent underage
            participation. If you become aware that an under-18 has used
            SnapWin, please contact us so we can investigate and take
            appropriate action.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            5. Getting help and support
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            If you are worried about your play, or about someone close to you,
            consider speaking to a professional support service. In Ireland,
            organisations such as{" "}
            <span className="font-semibold">Problem Gambling Ireland</span> and
            similar support bodies offer confidential advice and assistance.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            Your GP or a mental health professional can also help you access
            appropriate support services.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            6. Contacting us
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            If you have questions about responsible play on SnapWin, or would
            like to know more about the tools we offer to help you manage your
            participation, please contact us via the support section of the app
            or the contact details provided on our website.
          </p>
        </section>
      </div>
    </main>
  );
}
