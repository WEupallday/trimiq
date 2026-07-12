import Link from "next/link";

export const metadata = { title: "Terms of Service — TrimIQ" };

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-10 text-lg font-semibold text-white">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 text-sm leading-relaxed text-white/60">{children}</p>
);

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-300 hover:underline">— Back to TrimIQ</Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">Terms of Service</h1>
      <p className="mt-2 text-xs text-white/35">
        Last updated: July 2026. This is a standard template provided for convenience and is not legal advice.
      </p>

      <H>1. The service</H>
      <P>
        TrimIQ is an automated video editing service: you upload videos, TrimIQ processes them (cutting, captions,
        zoom effects and related features) and returns an edited result. By creating an account or using the service
        you agree to these terms.
      </P>

      <H>2. Intellectual property</H>
      <P>
        The TrimIQ service — including its software, editing engine, website, design, branding, copy and all related
        content — is the intellectual property of TrimIQ. You may not copy, clone, scrape, reverse-engineer, resell or
        create derivative services from any part of it without written permission. Automated scraping of the site or
        API abuse is prohibited.
      </P>

      <H>3. Your content</H>
      <P>
        You keep full ownership of the videos you upload and the edited results. You grant TrimIQ a limited license to
        store and process your uploads solely to provide the service. You are responsible for having the rights to any
        content you upload.
      </P>

      <H>4. Acceptable use</H>
      <P>
        Do not use TrimIQ to process unlawful content, content that infringes the rights of others, or malware; do not
        attempt to disrupt the service, circumvent plan limits, or access other users’ data. We may suspend accounts
        that violate these rules.
      </P>

      <H>5. Plans, credits & billing</H>
      <P>
        Paid subscriptions are billed by Stripe on a recurring monthly basis. Each successful edit consumes one credit;
        failed edits do not. Credits reset each billing cycle and do not roll over. You can upgrade, downgrade or cancel
        at any time from your dashboard — changes take effect at the end of the current cycle. Fair-use applies to
        unlimited plans.
      </P>

      <H>6. Disclaimer & liability</H>
      <P>
        The service is provided “as is” without warranties of any kind. Automated editing may make imperfect cuts;
        always review results before publishing. To the maximum extent permitted by law, TrimIQ is not liable for
        indirect or consequential damages, and its total liability is limited to the amount you paid in the previous
        three months.
      </P>

      <H>7. Changes & contact</H>
      <P>
        We may update these terms; continued use after changes means acceptance. Questions? Use the Help widget in the
        corner of any page to message the team.
      </P>
    </main>
  );
}
