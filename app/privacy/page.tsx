// app/privacy/page.tsx
import { COLORS } from "@/lib/colors";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: COLORS.screenBg }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <header className="space-y-1">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: COLORS.primary }}
          >
            Privacy Policy
          </h1>
          <p className="text-xs" style={{ color: COLORS.textMuted }}>
            Last updated: {new Date().toLocaleDateString("en-IE")}
          </p>
        </header>

        <section className="space-y-3 text-sm leading-relaxed">
          <p style={{ color: COLORS.textSecondary }}>
            This Privacy Policy explains how SnapWin (&quot;we&quot;,
            &quot;us&quot;, &quot;our&quot;) collects, uses and protects your
            personal data when you use the SnapWin mobile application and any
            related websites or services (the &quot;Service&quot;).
          </p>
          <p style={{ color: COLORS.textSecondary }}>
            We are committed to protecting your privacy and handling your data
            in accordance with applicable data protection laws, including the
            General Data Protection Regulation (&quot;GDPR&quot;) and relevant
            Irish legislation.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            1. Data controller
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            The data controller responsible for your personal data in connection
            with SnapWin is the operator of the SnapWin platform. Contact
            details will be provided in-app and on the website for any privacy
            queries.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            2. Information we collect
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            Depending on how you use the Service, we may collect:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              Account information (such as name, email address, phone number,
              county or region).
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Usage information (such as app interactions, device information,
              IP address and general location derived from your IP).
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Payment-related information (handled primarily by our payment
              provider; we receive limited information about transaction status
              and amounts).
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Support communications and any information you provide when you
              contact us with queries or issues.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            3. How we use your information
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We use your personal data for the following purposes:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              To create and manage your account.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              To process entries, payments and draws for raffles.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              To provide you with updates about your entries, results and
              account activity (for example, via in-app notifications or email).
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              To improve and secure the Service, including analytics, fraud
              prevention and troubleshooting.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              To comply with legal and regulatory obligations, including
              age-verification, anti-money laundering checks where applicable
              and record-keeping requirements.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            4. Legal bases for processing
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We process your personal data on the following legal bases:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              Performance of a contract: to provide the Service, process your
              entries and manage your account.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Legal obligation: to comply with applicable laws, regulatory
              requirements and licence conditions.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Legitimate interests: to improve the Service, prevent abuse and
              protect our users, provided that these interests are not
              overridden by your rights.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Consent: where required for specific optional features (for
              example, certain types of marketing communications).
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            5. Sharing your information
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We may share your personal data with:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              Payment providers (such as Stripe) to process transactions.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Cloud hosting, analytics and security service providers who help
              us operate and improve the Service.
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              Regulators or law enforcement agencies where required by law or in
              response to a valid legal request.
            </li>
          </ul>
          <p style={{ color: COLORS.textSecondary }}>
            We do not sell your personal data.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            6. International transfers
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            Where we transfer your data outside the European Economic Area
            (EEA), we will ensure that appropriate safeguards are in place, such
            as standard contractual clauses or equivalent mechanisms that comply
            with data protection laws.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            7. Data retention
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We retain your personal data only for as long as necessary to fulfil
            the purposes described in this policy, including any legal,
            accounting or reporting requirements. After this period, data may be
            anonymised or securely deleted.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            8. Your rights
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            Under data protection law, you may have the following rights:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li style={{ color: COLORS.textSecondary }}>
              the right to access your personal data;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              the right to rectify inaccurate or incomplete data;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              the right to request erasure of your data in certain
              circumstances;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              the right to restrict or object to processing in certain cases;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              the right to data portability in some situations;
            </li>
            <li style={{ color: COLORS.textSecondary }}>
              the right to withdraw consent where processing is based on
              consent.
            </li>
          </ul>
          <p style={{ color: COLORS.textSecondary }}>
            You can exercise these rights by contacting us using the details
            provided in the app or on the website. You also have the right to
            lodge a complaint with the Irish Data Protection Commission if you
            are unhappy with how we handle your data.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            9. Security
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We implement appropriate technical and organisational measures to
            protect your personal data against unauthorised access, loss or
            misuse. However, no system is completely secure, and we cannot
            guarantee absolute security of your information.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed">
          <h2
            className="text-base font-semibold"
            style={{ color: COLORS.primary }}
          >
            10. Changes to this policy
          </h2>
          <p style={{ color: COLORS.textSecondary }}>
            We may update this Privacy Policy from time to time. Where changes
            are material, we will take reasonable steps to inform you. Your
            continued use of the Service after any changes take effect will
            constitute your acceptance of the updated policy.
          </p>
        </section>
      </div>
    </main>
  );
}
