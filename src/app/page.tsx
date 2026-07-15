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
          TrimIQ removes silence, filler words and bad takes, burns in captions,
          adds smart zooms, and hands back a clean, ready-to-post edit for TikTok, Reels & Shorts in minutes &mdash;
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

        {/* Self-playing product demo (pure CSS, no video, no JS) */}
        <div className="mx-auto mt-16 max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left shadow-2xl backdrop-blur sm:p-6">
          <div className="flex items-center justify-between pb-3 text-xs font-medium text-white/40">
            <span className="flex items-center gap-2.5">
              <span className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white/15" />
                <span className="h-2 w-2 rounded-full bg-white/15" />
                <span className="h-2 w-2 rounded-full bg-white/15" />
              </span>
              TrimIQ &mdash; Editor
            </span>
            <span className="text-white/25">auto demo</span>
          </div>
          <div className="tiq-stage relative w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b0d16]" style={{ aspectRatio: "16 / 9" }}>
            {/* draggable file chip */}
            <div className="tiq-file absolute z-10 flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-[11px] text-white/80">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5l8 4.5-8 4.5z" fill="currentColor" /></svg>
              raw-clip.mp4 &middot; 3:12
            </div>
            {/* dashed dropzone */}
            <div className="tiq-drop absolute flex items-center justify-center rounded-xl border-2 border-dashed border-white/15 text-[11px] text-white/30">
              Drop your video here
            </div>
            {/* preview after drop */}
            <div className="tiq-preview absolute flex items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500/25 via-fuchsia-500/10 to-transparent">
              <div className="tiq-cap rounded-md bg-black/75 px-3 py-1.5 text-[12px] font-bold tracking-wide text-white">
                THIS IS THE GOOD TAKE
              </div>
            </div>
            {/* Edit Instructions input (typed live) */}
            <div className="tiq-input absolute flex items-center rounded-lg border border-white/15 bg-white/[0.06] px-2.5">
              <span className="tiq-type overflow-hidden whitespace-nowrap font-mono text-[10px] leading-none text-white/80">add zooms, blue captions</span>
            </div>
            {/* status line */}
            <div className="tiq-analyze absolute text-[11px] text-indigo-300/80">Analyzing speech &middot; removing silence, fillers &amp; bad takes&hellip;</div>
            {/* timeline: kept (indigo) vs cut (red) */}
            <div className="tiq-timeline absolute flex gap-[3px]">
              <span className="rounded-sm bg-indigo-400/70" style={{ flexGrow: 2, flexBasis: 0 }} />
              <span className="tiq-cut tiq-cutA rounded-sm bg-red-400/40" />
              <span className="rounded-sm bg-indigo-400/70" style={{ flexGrow: 3, flexBasis: 0 }} />
              <span className="tiq-cut tiq-cutB rounded-sm bg-red-400/40" />
              <span className="rounded-sm bg-indigo-400/70" style={{ flexGrow: 2, flexBasis: 0 }} />
              <span className="tiq-cut tiq-cutC rounded-sm bg-red-400/40" />
              <span className="rounded-sm bg-indigo-400/70" style={{ flexGrow: 4, flexBasis: 0 }} />
            </div>
            {/* done badge */}
            <div className="tiq-badge absolute flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-200">
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              Ready to post &middot; 1:58
            </div>
            {/* cursor */}
            <div className="tiq-cursor absolute z-20">
              <svg className="tiq-click" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 3l14 10-6.2 1 3.4 6.4-2.8 1.4-3.4-6.4L5 20z" fill="#fff" stroke="#0b0d16" strokeWidth="1.4" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
            <span className="flex gap-4">
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-indigo-400/70" />kept</span>
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-red-400/40" />removed by TrimIQ</span>
            </span>
            <span className="hidden sm:inline">watch TrimIQ clean a clip &mdash; on a loop</span>
          </div>
          <style>{`
          /* Base = finished frame (reduced-motion users see this static). */
          .tiq-file{left:6%;top:16%;opacity:0}
          .tiq-drop{left:42%;top:8%;width:52%;height:46%;opacity:0}
          .tiq-preview{left:42%;top:8%;width:52%;height:46%;opacity:1}
          .tiq-input{left:42%;top:58%;width:52%;height:9%;opacity:0}
          .tiq-type{width:24ch;border-right:2px solid transparent}
          .tiq-analyze{left:6%;bottom:32%;opacity:0}
          .tiq-timeline{left:6%;right:6%;bottom:16%;height:9%;opacity:1}
          .tiq-cut{flex-grow:0;flex-shrink:0;flex-basis:0%;opacity:0}
          .tiq-cap{transform:scale(1)}
          .tiq-badge{right:6%;bottom:5%;opacity:1}
          .tiq-cursor{left:88%;top:85%;opacity:0}
          @media (prefers-reduced-motion: no-preference){
            .tiq-cursor{opacity:1;animation:tiqCursor 13s cubic-bezier(.45,.05,.25,1) infinite}
            .tiq-click{animation:tiqClick 13s linear infinite;transform-origin:25% 15%}
            .tiq-file{animation:tiqFile 13s cubic-bezier(.45,.05,.25,1) infinite}
            .tiq-drop{animation:tiqDrop 13s linear infinite}
            .tiq-preview{animation:tiqPreview 13s linear infinite}
            .tiq-input{animation:tiqInput 13s linear infinite}
            .tiq-type{width:0ch;animation:tiqType 13s infinite,tiqCaret 1s steps(1) infinite}
            .tiq-analyze{animation:tiqAnalyze 13s linear infinite}
            .tiq-timeline{animation:tiqTimeline 13s linear infinite}
            .tiq-cutA{animation:tiqCutA 13s ease-in-out infinite}
            .tiq-cutB{animation:tiqCutB 13s ease-in-out infinite}
            .tiq-cutC{animation:tiqCutC 13s ease-in-out infinite}
            .tiq-cap{animation:tiqCap 13s cubic-bezier(.34,1.56,.64,1) infinite}
            .tiq-badge{animation:tiqBadge 13s ease-out infinite}
          }
          @keyframes tiqCursor{0%{left:88%;top:85%}6%,9%{left:16%;top:22%}18%,21%{left:60%;top:26%}24%,27%{left:52%;top:63%}50%{left:62%;top:48%}74%,86%{left:79%;top:76%}100%{left:88%;top:85%}}
          @keyframes tiqClick{0%,6%,8%,23.5%,26.5%,82.5%,85.5%,100%{transform:scale(1)}7%,25%,84%{transform:scale(.72)}}
          @keyframes tiqFile{0%,6%{left:6%;top:16%;opacity:1;transform:scale(1)}18%{left:46%;top:16%;opacity:1;transform:scale(1)}21.5%{left:48%;top:20%;opacity:0;transform:scale(.6)}95%{left:6%;top:16%;opacity:0;transform:scale(1)}100%{left:6%;top:16%;opacity:1}}
          @keyframes tiqDrop{0%,17%{opacity:1;background:transparent}19%{opacity:1;background:rgba(129,140,248,.14)}23%,96%{opacity:0;background:transparent}100%{opacity:1}}
          @keyframes tiqPreview{0%,20%{opacity:0}24%,95%{opacity:1}99%,100%{opacity:0}}
          @keyframes tiqInput{0%,21%{opacity:0;transform:translateY(5px);border-color:rgba(255,255,255,.15)}24%,45.5%{opacity:1;transform:translateY(0);border-color:rgba(255,255,255,.15)}47%{opacity:1;border-color:rgba(129,140,248,.7)}48.5%{opacity:1;border-color:rgba(129,140,248,.7)}52%,100%{opacity:0;transform:translateY(0);border-color:rgba(255,255,255,.15)}}
          @keyframes tiqType{0%,26%{width:0ch;animation-timing-function:steps(9)}31%{width:9ch;animation-timing-function:steps(1)}33%{width:9ch;animation-timing-function:steps(3)}35%{width:6ch;animation-timing-function:steps(1)}36.5%{width:6ch;animation-timing-function:steps(18)}45.5%,100%{width:24ch}}
          @keyframes tiqCaret{0%,100%{border-right-color:transparent}50%{border-right-color:rgba(255,255,255,.65)}}
          @keyframes tiqAnalyze{0%,48%{opacity:0}51.5%,60%{opacity:1}64%,100%{opacity:0}}
          @keyframes tiqTimeline{0%,49%{opacity:0}54%,95%{opacity:1}99%,100%{opacity:0}}
          @keyframes tiqCutA{0%,56%{flex-basis:9%;opacity:.85}61%,100%{flex-basis:0%;opacity:0}}
          @keyframes tiqCutB{0%,62%{flex-basis:7%;opacity:.85}67%,100%{flex-basis:0%;opacity:0}}
          @keyframes tiqCutC{0%,68%{flex-basis:10%;opacity:.85}73%,100%{flex-basis:0%;opacity:0}}
          @keyframes tiqCap{0%,72%{transform:scale(0)}75%{transform:scale(1.1)}76.5%,94%{transform:scale(1)}97%,100%{transform:scale(0)}}
          @keyframes tiqBadge{0%,76%{opacity:0;transform:translateY(8px)}79.5%,95%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
          `}</style>
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
              title: "TrimIQ cleans the edit",
              body: "It transcribes every word, removes silence, filler words, false starts and bad takes \u2014 and keeps your best delivery intact.",
              foot: "Captions \u00b7 smart zooms \u00b7 plain-English instructions",
            },
            {
              n: "3",
              title: "Export & post",
              body: "Review what changed, regenerate with different settings if you like, then download \u2014 full resolution, ready for TikTok, Reels & Shorts.",
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
            { t: "Keeps what matters", b: "Protect your intro or any phrase \u2014 TrimIQ never touches it." },
            { t: "Auto captions", b: "Burned-in, word-accurate. 45+ colors, 7 positions, 3 styles." },
            { t: "Edit Instructions", b: "Type it in plain English: \u201ccut harder, gold captions top right.\u201d" },
            { t: "Smart zoom effects", b: "TrimIQ picks the punch-in moments \u2014 no timestamps needed." },
            { t: "3 editing styles", b: "Beginner, Balanced or Aggressive pacing \u2014 one click." },
            { t: "Batch upload", b: "Drop in up to 20 videos at once, each with live status." },
            { t: "Background processing", b: "Close the tab. The queue keeps working and notifies you when done." },
            { t: "Queue & notifications", b: "Uploading \u2192 Processing \u2192 Completed, per video, in real time." },
            { t: "Flexible downloads", b: "Grab videos one at a time or everything completed at once." },
            { t: "Review page", b: "Before/after player, cut timeline, transcript with removed words." },
            { t: "Regenerate", b: "New style or instructions without re-uploading the original." },
            { t: "Multi-platform export", b: "Full resolution, exact framing, no watermark \u2014 ever." },
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
