"use client";

// In-app support widget. 100% rule-based (zero recurring cost): a small FAQ
// matcher answers common questions instantly; anything else can be sent to
// the team - stored as a SupportTicket and pushed to Discord via notify().
import { useState } from "react";

type Msg = { from: "bot" | "user"; text: string; link?: { href: string; label: string } };

const FAQS: { match: RegExp; text: string; link?: { href: string; label: string } }[] = [
  {
    match: /upload|start|how do i|get started|drag|drop/i,
    text: "Open the editor, then drag one or more videos into the drop zone (or click it to browse). Pick an editing style, optionally add captions or instructions, and hit the button - TrimIQ does the rest.",
    link: { href: "/dashboard", label: "Open the editor" },
  },
  {
    match: /credit|limit|how many|edits per|monthly|quota/i,
    text: "Every successful edit uses 1 credit - failed edits never cost anything. Free includes 5 edits/month, Starter 80, Pro 250, Unlimited is fair-use. Credits reset each billing cycle.",
    link: { href: "/#pricing", label: "See plans" },
  },
  {
    match: /plan|price|pricing|upgrade|subscribe|cost|pay/i,
    text: "Free is $0 to try TrimIQ. Paid plans add more edits, captions, instructions, zooms, bigger batches and priority processing. You can upgrade or cancel any time from your dashboard.",
    link: { href: "/#pricing", label: "Compare plans" },
  },
  {
    match: /caption|subtitle/i,
    text: 'Turn on Auto captions on the upload card, or just describe them in Edit instructions - e.g. "gold boxed captions at the top right". 45+ colors, 7 positions and 3 styles are supported (Starter and up).',
  },
  {
    match: /zoom/i,
    text: 'Type it in Edit instructions: "add subtle zooms", "zoom on the key moments", or target an exact line - zoom in when I say "wow" - and TrimIQ finds that moment in your transcript (Pro and up).',
  },
  {
    match: /instruction|tell it|command|prompt/i,
    text: 'Edit instructions are plain English: "don’t cut the intro", "target 30 seconds", "remove all filler words", "mint captions bottom left". Anything TrimIQ can’t map is politely ignored and listed for you.',
  },
  {
    match: /batch|multiple|several|queue|background|close the tab/i,
    text: "Drop several videos at once - they upload up-front and keep processing on our servers even if you close the tab. You’ll see per-video statuses and get a notification here when the whole batch is done.",
  },
  {
    match: /download|export|save|get my video/i,
    text: 'Every finished video has its own Download button, and paid plans get "Download all completed" above Recent projects. Exports are full resolution with no watermark.',
  },
  {
    match: /fail|error|stuck|didn.?t work|broken|crash/i,
    text: "Failed edits never use a credit. Most failures are unsupported files or videos longer than your plan allows - MP4/MOV/WebM under your plan’s length limit work best. If it keeps happening, send us a message below.",
  },
  {
    match: /cancel|refund|billing|invoice|card/i,
    text: "You can manage or cancel your subscription any time from the Billing section of your dashboard - changes apply at the end of the current cycle.",
    link: { href: "/dashboard", label: "Go to billing" },
  },
];

const QUICK = ["How do uploads work?", "How do credits work?", "Caption options", "Zoom on a phrase", "Batch editing"];

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: "bot", text: "Hi! What do you need help with?" },
  ]);
  const [input, setInput] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [misses, setMisses] = useState(0);

  function answer(q: string) {
    const question = q.trim();
    if (!question) return;
    setMsgs((m) => [...m, { from: "user", text: question }]);
    setInput("");
    if (/human|person|team|someone|contact|talk to|real|agent/i.test(question)) {
      setHandoff(true);
      setMsgs((m) => [...m, { from: "bot", text: "Sure - write your message below and it goes straight to the TrimIQ team." }]);
      return;
    }
    const hit = FAQS.find((f) => f.match.test(question));
    if (hit) {
      setMsgs((m) => [...m, { from: "bot", text: hit.text, link: hit.link }]);
      setMisses(0);
    } else {
      const n = misses + 1;
      setMisses(n);
      setMsgs((m) => [
        ...m,
        {
          from: "bot",
          text:
            n >= 2
              ? "I don’t have a good answer for that - want to send it to the team? Use the box below and we’ll get back to you."
              : "Hmm, I’m not sure about that one. Try asking about uploads, credits, captions, zooms, batches or downloads - or type “talk to a human”.",
        },
      ]);
      if (n >= 2) setHandoff(true);
    }
  }

  async function sendTicket() {
    const message = input.trim();
    if (message.length < 3 || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, email: email.trim() || undefined, page: location.pathname }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Failed to send");
      setSent(true);
      setMsgs((m) => [...m, { from: "user", text: message }, { from: "bot", text: "Sent! The team has been notified and will get back to you soon." }]);
      setInput("");
    } catch (e) {
      setMsgs((m) => [...m, { from: "bot", text: e instanceof Error ? e.message : "Couldn’t send - please try again." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 text-left">
      {open && (
        <div className="mb-3 flex h-[28rem] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f1a]/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">TrimIQ support</p>
              <p className="text-[11px] text-white/40">Instant answers, or message the team</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-white/40 transition hover:text-white" aria-label="Close support">
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed ${m.from === "user" ? "bg-indigo-500/30 text-indigo-50" : "bg-white/[0.06] text-white/80"}`}>
                  {m.text}
                  {m.link && (
                    <a href={m.link.href} className="mt-1 block text-[11px] font-medium text-indigo-300 underline-offset-2 hover:underline">
                      {m.link.label} →
                    </a>
                  )}
                </div>
              </div>
            ))}
            {msgs.length <= 1 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK.map((q) => (
                  <button key={q} type="button" onClick={() => answer(q)} className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60 transition hover:bg-white/10">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-white/10 p-3">
            {handoff && !sent && (
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email (so we can reply)"
                className="mb-2 w-full rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[12px] text-white placeholder-white/30 outline-none focus:border-indigo-400/50"
              />
            )}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (handoff && !sent ? sendTicket() : answer(input)); }}
                placeholder={handoff && !sent ? "Write your message to the team…" : "Ask a question…"}
                className="flex-1 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-[12px] text-white placeholder-white/30 outline-none focus:border-indigo-400/50"
              />
              <button
                type="button"
                disabled={sending}
                onClick={() => (handoff && !sent ? sendTicket() : answer(input))}
                className="rounded-lg bg-indigo-500/80 px-3 py-2 text-[12px] font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {handoff && !sent ? (sending ? "…" : "Send") : "Ask"}
              </button>
            </div>
            {!handoff && (
              <button type="button" onClick={() => setHandoff(true)} className="mt-2 text-[11px] text-white/35 transition hover:text-white/60">
                Need a human? Message the team →
              </button>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open support chat"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_-6px_rgba(129,140,248,0.6)] transition hover:-translate-y-0.5"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 3.5C2 2.7 2.7 2 3.5 2h9c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H6l-3 3v-3h-.5C1.7 11 1 10.3 1 9.5z" fill="currentColor" />
        </svg>
        {open ? "Close" : "Help"}
      </button>
    </div>
  );
}
