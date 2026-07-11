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
                Open TrimIQ
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
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-20 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          AI video editing for short-form creators
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-6xl">
          Raw footage in.
          <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent"> Ready-to-post out.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/60">
          TrimIQ&apos;s AI removes silence, filler words and bad takes, burns in captions,
          adds smart zooms, and hands back a clean, TikTok-ready edit in minutes &mdash;
          one video or a whole batch while you do something else.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href={loggedIn ? "/dashboard" : "/signup"}
            className="rounded-xl bg-white px-7 py-3.5 text-base font-semibold text-ink shadow-[0_0_40px_-8px_rgba(129,140,248,0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_0_56px_-8px_rgba(129,140,248,0.8)]"
          >
            {loggedIn ? "Open the editor" : "Start editing free"}
          </Link>
          <Link
            href="#how"
            className="rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 text-base font-medium text-white/80 transition hover:bg-white/10"
          >
            See how it works
          </Link>
        </div>
        <p className="mt-4 text-sm text-white/40">5 free edits every month &middot; full quality &middot; no credit card</p>

        {/* Before / after strip */}
        <div className="mx-auto mt-16 max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-left shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between text-xs font-medium text-white/40">
            <span>Your raw clip &middot; 3:12</span>
            <span className="text-white/25">TrimIQ</span>
          </div>
          <div className="mt-3 flex h-6 w-full gap-[3px] overflow-hidden rounded-md">
            <div className="basis-[9%] rounded-sm bg-indigo-400/70" />
            <div className="basis-[6%] rounded-sm bg-red-400/30" />
            <div className="basis-[13%] rounded-sm bg-indigo-400/70" />
            <div className="basis-[4%] rounded-sm bg-red-400/30" />
            <div className="basis-[7%] rounded-sm bg-red-400/30" />
            <div className="basis-[17%] rounded-sm bg-indigo-400/70" />
            <div className="basis-[5%] rounded-sm bg-red-400/30" />
            <div className="basis-[12%] rounded-sm bg-indigo-400/70" />
            <div className="basis-[8%] rounded-sm bg-red-400/30" />
            <div className="basis-[19%] rounded-sm bg-indigo-400/70" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-xs text-white/50">
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-indigo-400/70" />Kept &mdash; your best takes</span>
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-red-400/30" />Removed &mdash; silence, fillers, retakes</span>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
              Clean edit &middot; 1:58 &middot; captions on
            </span>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Three steps. That&apos;s the whole workflow.</h2>
          <p className="mt-4 text-white/60">No timeline, no keyframes, no editing skills.</p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            {
              n: "1",
              title: "Upload your videos",
              body: "Drag in one clip or a whole batch. TrimIQ queues everything automatically \u2014 you can close the tab and come back.",
              foot: "Batch upload \u00b7 background processing",
            },
            {
              n: "2",
              title: "AI cleans the edit",
              body: "It transcribes every word, removes silence, filler words, false starts and bad takes \u2014 and keeps your best delivery intact.",
              foot: "Captions \u00b7 smart zooms \u00b7 plain-English instructions",
            },
            {
              n: "3",
              title: "Export & post",
              body: "Review what changed, regenerate with different settings if you like, then download \u2014 full resolution, ready for TikTok.",
              foot: "No watermark \u00b7 download one or all",
            },
          ].map((s) => (
            <div key={s.n} className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 transition hover:-translate-y-1 hover:border-indigo-400/30 hover:bg-white/[0.05]">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/20 text-lg font-bold text-indigo-200">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">{s.body}</p>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-white/30">{s.foot}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- FEATURES ---------- */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Everything TrimIQ does</h2>
          <p className="mt-4 text-white/60">
            One upload triggers the full pipeline &mdash; here&apos;s the complete list, no fine print.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Silence & dead-space removal", b: "Long pauses and empty air disappear automatically." },
            { t: "Filler-word removal", b: "Um, uh, like, so \u2014 gone. Add your own words to cut, or keep them." },
            { t: "Bad-take detection", b: "Said it three times? TrimIQ keeps only your final, best take." },
            { t: "Smoother flow", b: "Sentence-aware cuts and pause cleanup that never feel choppy." },
            { t: "Keeps what matters", b: "Protect your intro or any phrase \u2014 the AI never touches it." },
            { t: "AI captions", b: "Burned-in, word-accurate. 45+ colors, 7 positions, 3 styles." },
            { t: "Edit Instructions", b: "Type it in plain English: \u201ccut harder, gold captions top right.\u201d" },
            { t: "AI zoom effects", b: "The engine picks the punch-in moments \u2014 no timestamps needed." },
            { t: "3 editing styles", b: "Beginner, Balanced or Aggressive pacing \u2014 one click." },
            { t: "Batch upload", b: "Drop in up to 20 videos at once, each with live status." },
            { t: "Background processing", b: "Close the tab. The queue keeps working and notifies you when done." },
            { t: "Queue & notifications", b: "Uploading \u2192 Processing \u2192 Completed, per video, in real time." },
            { t: "Flexible downloads", b: "Grab videos one at a time or everything completed at once." },
            { t: "Review page", b: "Before/after player, cut timeline, transcript with removed words." },
            { t: "Regenerate", b: "New style or instructions without re-uploading the original." },
            { t: "TikTok-ready export", b: "Full resolution, exact framing, no watermark \u2014 ever." },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-indigo-400/25 hover:bg-white/[0.05]">
              <div className="mb-3 h-1.5 w-8 rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400" />
              <h3 className="text-sm font-semibold">{f.t}</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/55">{f.b}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-white/40">
          Credits only count <span className="text-white/70">successful</span> edits &mdash; a failed video never costs anything.
        </p>
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
              {loggedIn ? "Open TrimIQ" : "Start Editing Free"}
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
