// app/terms/page.tsx
import Link from "next/link";
import { COLORS } from "@/lib/colors";

export default function TermsPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: COLORS.screenBg }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <header className="space-y-1">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: COLORS.primary }}
          >
            Terms &amp; Conditions
          </h1>
          <p className="text-xs" style={{ color: COLORS.textMuted }}>
            Last updated: {new Date().toLocaleDateString("en-IE")}
          </p>
        </header>

        <section className="space-y-3 text-sm leading-relaxed">
          <p style={{ color: COLORS.textSecondary }}>
            These Terms &amp; Conditions (&quot;Terms&quot;) govern your access
            to and use of the SnapWin mobile application and any related
            websites, services and features (together, the &quot;Service&quot;).
            By creating an account, purchasing entries or otherwise using the
            Service, you agree to be bound by these Terms.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            SnapWin is intended to operate raffles and games of chance in
            accordance with applicable Irish law and any other relevant
            regulations. Real-money raffles will only be offered where the
            necessary permissions, licences and regulatory approvals are in
            place.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            1. Eligibility
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            1.1. You must be at least 18 years of age to use SnapWin and to
            participate in any raffles or games of chance. By using the Service,
            you confirm that you are 18 or over and legally permitted to take
            part in such activities in your jurisdiction.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            1.2. SnapWin may restrict access to certain raffles based on your
            location or other eligibility criteria required by law, by the
            applicable licence or by the organiser of the raffle.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            1.3. You are responsible for ensuring that your use of the Service
            complies with all laws and regulations that apply to you.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            2. Accounts and security
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            2.1. To enter raffles, you may be required to create an account and
            provide accurate, complete information. You are responsible for
            keeping your login credentials secure and for all activity that
            occurs under your account.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            2.2. SnapWin reserves the right to suspend or close accounts where
            we have reasonable grounds to suspect misuse, fraud, underage use,
            breaches of these Terms or breaches of applicable law.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            3. Raffles and entries
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            3.1. Each raffle listed within SnapWin will display key information
            including the prize description, ticket price, maximum number of
            tickets, closing date or draw date and any specific rules or
            eligibility requirements.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            3.2. By purchasing a ticket, you agree to the specific rules and
            conditions of that raffle as displayed in the app at the time of
            entry. In the event of any conflict between raffle-specific rules
            and these Terms, the raffle-specific rules will prevail for that
            raffle only.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            3.3. Entries are only valid once payment has been successfully
            processed and confirmed. Where payment fails or is reversed, SnapWin
            may void any associated entries.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            3.4. Unless explicitly stated otherwise, entries are non-refundable
            once successfully purchased, except where required by law or where a
            raffle is cancelled by SnapWin or the organiser.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            4. Payments and pricing
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            4.1. Payments are processed via third-party payment providers (for
            example, Stripe). SnapWin does not store your full card details on
            its own servers.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            4.2. All prices are displayed in euro (€) unless otherwise stated.
            Any transaction fees, taxes or charges will be disclosed where
            applicable.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            4.3. You are responsible for ensuring that your payment method is
            valid and authorised. We may cancel entries where payment is
            declined, reversed or suspected to be fraudulent.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            5. Draws, winners and prizes
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            5.1. Draws are conducted using SnapWin&apos;s draw engine or another
            approved method specified for the raffle. The draw logic is designed
            to be fair and auditable.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            5.2. Winners will be selected at random from all valid entries
            received before the closing time, in accordance with the rules of
            the raffle.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            5.3. Winners will be notified via the app and/or the contact details
            associated with their account. If a winner cannot be contacted or
            does not respond within the timeframe specified in the raffle rules,
            SnapWin or the organiser may select an alternative winner or handle
            the prize in accordance with applicable law and the raffle rules.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            5.4. Prizes are non-transferable and may not be exchanged or
            redeemed for cash, unless explicitly stated otherwise in the raffle
            rules or required by law.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            6. Responsible play
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            6.1. SnapWin encourages responsible participation and does not
            promote gambling as a way to solve financial problems.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            6.2. You should only spend what you can afford to lose and should
            stop if you feel that participation is no longer enjoyable or is
            creating stress or financial pressure.
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            6.3. Additional information and support resources are available on
            our{" "}
            <Link
              href="/responsible-play"
              className="underline"
              style={{ color: COLORS.primary }}
            >
              Responsible Play
            </Link>{" "}
            page.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            7. Prohibited conduct
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            You agree not to misuse the Service, including (without limitation)
            by:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              attempting to manipulate the outcome of any raffle;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              creating multiple accounts or using false identities;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              engaging in fraud, money laundering or other unlawful activity;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              interfering with the security or operation of the Service.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            8. Limitation of liability
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            To the fullest extent permitted by law, SnapWin and its owners,
            directors, employees and agents shall not be liable for any indirect
            or consequential loss, loss of profits, loss of data or any other
            loss or damage arising from your use of the Service or participation
            in any raffle, except where such liability cannot be excluded under
            applicable law.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            9. Changes to these Terms
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            SnapWin may update these Terms from time to time. Where changes are
            material, we will take reasonable steps to notify you (for example,
            via the app or by email). Your continued use of the Service after
            the effective date of any changes constitutes your acceptance of the
            updated Terms.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            10. Governing law and jurisdiction
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            These Terms are governed by the laws of Ireland. Any disputes
            arising from or relating to these Terms or your use of the Service
            shall be subject to the non-exclusive jurisdiction of the Irish
            courts.
          </p>
        </section>
      </div>
    </main>
  );
}
