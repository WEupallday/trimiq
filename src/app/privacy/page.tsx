import Link from "next/link";

export const metadata = { title: "Privacy Policy — TrimIQ" };

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-10 text-lg font-semibold text-white">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 text-sm leading-relaxed text-white/60">{children}</p>
);

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-indigo-300 hover:underline">— Back to TrimIQ</Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">Privacy Policy</h1>
      <p className="mt-2 text-xs text-white/35">
        Last updated: July 2026. This is a standard template provided for convenience and is not legal advice.
      </p>

      <H>1. What we collect</H>
      <P>
        Account information (email, username, optional TikTok handle), the videos you upload for editing, and
        self-hosted usage analytics (events like uploads, completed edits and downloads) used to improve the product.
        We do not use third-party trackers or advertising pixels.
      </P>

      <H>2. Your videos</H>
      <P>
        Uploads are processed automatically to produce your edit. Original files are kept only so you can regenerate
        without re-uploading, then deleted automatically per your plan’s retention window (24 hours to 7 days).
        Speech audio is transcribed by our processing provider solely to power editing features.
      </P>

      <H>3. What we never do</H>
      <P>
        We do not sell your personal data, and we do not use your videos for anything other than providing the service
        to you.
      </P>

      <H>4. Payments</H>
      <P>
        Payments are handled entirely by Stripe; TrimIQ never sees or stores your card details.
      </P>

      <H>5. Cookies</H>
      <P>
        We use essential cookies only: a session cookie to keep you signed in and an anonymous identifier for
        first-party analytics. No advertising cookies.
      </P>

      <H>6. Contact & requests</H>
      <P>
        To ask about your data, request deletion, or anything else, message us via the Help widget in the corner of
        any page — it goes straight to the team.
      </P>
    </main>
  );
}
