import Link from "next/link";
import Logo from "@/components/Logo";
import { getSession } from "@/lib/auth";
import { ALL_PLANS } from "@/lib/plans";
import { getLivePrices } from "@/lib/stripe";
import PricingButton from "@/components/PricingButton";

export default async function Home() {
  const session = await getSession();
  const loggedIn = !!session;
  // Prices are read live from Stripe — nothing is hardcoded here.
  const prices = await getLivePrices();

  return (
    <main className="relative overflow-hidden">
      {/* Decorative glow blobs */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full bg-indigo-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-[600px] -left-40 h-[400px] w-[400px] rounded-full bg-fuchsia-600/10 blur-[120px]" />

      {/* ---------- NAV ---------- */}
      <header className="relative z-20">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo size={32} />
            <span className="text-lg">TrimIQ</span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-white/70 md:flex">
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            {loggedIn ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/90"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden rounded-lg px-4 py-2 text-sm text-white/80 transition hover:text-white sm:block"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/90"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16 text-center md:pt-24">
        <div className="animate-fade-up">
          <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Built for TikTok Shop creators
          </span>
        </div>

        <h1 className="animate-fade-up mx-auto mt-6 max-w-4xl text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          Turn raw clips into
          <br />
          <span className="text-gradient animate-gradient-pan">publish-ready videos</span>
        </h1>

        <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg text-white/60">
          TrimIQ automatically removes dead space, long pauses, and bad takes from
          your product videos. Upload, click once, download a clean edit — ready to post.
        </p>

        <div className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={loggedIn ? "/dashboard" : "/signup"}
            className="group relative w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-7 py-3.5 text-center font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 sm:w-auto"
          >
            {loggedIn ? "Go to Dashboard" : "Start free — 5 edits"}
          </Link>
          <a
            href="#how"
            className="glass w-full rounded-xl px-7 py-3.5 text-center font-medium text-white/80 transition hover:text-white sm:w-auto"
          >
            See how it works
          </a>
        </div>
        <p className="animate-fade-up mt-4 text-sm text-white/40">
          No credit card required · 5 free edits
        </p>

        {/* Mock app preview */}
        <div className="animate-fade-up animate-floaty mt-16">
          <div className="glass mx-auto max-w-3xl rounded-2xl p-2 shadow-2xl shadow-black/40">
            <div className="rounded-xl bg-panel p-6">
              <div className="mb-5 flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-400/70" />
                <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
                <span className="h-3 w-3 rounded-full bg-green-400/70" />
              </div>
              <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-12">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                </div>
                <p className="text-sm text-white/60">Drop your raw video here</p>
                <Link href={loggedIn ? "/dashboard" : "/signup"} className="rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2 text-sm font-medium transition hover:opacity-90">
                  Generate Clean Edit
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Three steps. Zero editing skills.
          </h2>
          <p className="mt-4 text-white/60">
            What used to take an hour in editing software now takes a few clicks.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Upload your video",
              d: "Drag in your raw recording — pauses, retakes, and all.",
            },
            {
              n: "02",
              t: "Click Generate Clean Edit",
              d: "TrimIQ detects silence and dead space and cuts it automatically.",
            },
            {
              n: "03",
              t: "Download & post",
              d: "Get a tight, clean video in original quality, ready for TikTok Shop.",
            },
          ].map((s) => (
            <div key={s.n} className="glass rounded-2xl p-7 transition hover:bg-white/[0.05]">
              <div className="text-sm font-semibold text-indigo-300">{s.n}</div>
              <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-white/60">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- FEATURES ---------- */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Auto pause removal", d: "Long silences and gaps are trimmed automatically." },
            { t: "Dead space cleanup", d: "Empty moments and false starts get cut." },
            { t: "Quality preserved", d: "Exports keep your original resolution and audio." },
            { t: "Fast turnaround", d: "Most clips are ready in under a couple of minutes." },
          ].map((f) => (
            <div key={f.t} className="glass rounded-2xl p-6">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </div>
              <h3 className="font-semibold">{f.t}</h3>
              <p className="mt-2 text-sm text-white/60">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- PRICING ---------- */}
      <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Simple pricing</h2>
          <p className="mt-4 text-white/60">Start free. Upgrade when you&apos;re ready to scale.</p>
        </div>

        <div className="mt-14 grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {ALL_PLANS.map((plan) => {
            const popular = plan.id === "pro";
            const amount = prices[plan.id]?.amount;
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-7 ${
                  popular
                    ? "border border-indigo-400/40 bg-gradient-to-b from-indigo-500/10 to-transparent shadow-xl shadow-indigo-500/10"
                    : "glass"
                }`}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1 text-xs font-medium">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-sm text-white/50">{plan.blurb}</p>
                <div className="mt-6 text-4xl font-bold">
                  {amount === null || amount === undefined ? (
                    <span className="text-2xl font-semibold text-white/50">Coming soon</span>
                  ) : (
                    <>
                      ${amount}
                      {amount > 0 && <span className="text-base font-normal text-white/50">/mo</span>}
                    </>
                  )}
                </div>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-white/70">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <PricingButton
                  planId={plan.id}
                  loggedIn={loggedIn}
                  highlight={popular}
                  label={plan.id === "free" ? "Get started" : `Choose ${plan.name}`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="glass relative overflow-hidden rounded-3xl px-8 py-16 text-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-600/15 to-fuchsia-600/15" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Stop editing. Start posting.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/60">
              Join creators saving hours every week with one-click clean edits.
            </p>
            <Link
              href={loggedIn ? "/dashboard" : "/signup"}
              className="mt-8 inline-block rounded-xl bg-white px-8 py-3.5 font-medium text-ink transition hover:bg-white/90"
            >
              {loggedIn ? "Go to Dashboard" : "Start free"}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-white/50 sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span>TrimIQ</span>
          </div>
          <p>© {new Date().getFullYear()} TrimIQ. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
