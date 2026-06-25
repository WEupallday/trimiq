"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Stats = {
  original: number;
  cleaned: number;
  removed: number;
  cuts: number;
  percent: number;
  capped: boolean;
};

type Project = {
  id: string;
  name: string;
  createdAt: number;
  status: "processing" | "done" | "error";
  stage: string;
  error: string | null;
  stats: Stats | null;
};

const MODES = [
  { id: "light", label: "Light", desc: "Minimal cuts" },
  { id: "balanced", label: "Balanced", desc: "Recommended" },
  { id: "aggressive", label: "Aggressive", desc: "Max trimming" },
] as const;

// Display steps. The active step is driven by the server's real stage.
const STEPS = ["Uploading", "Analyzing", "Detecting pauses", "Rendering", "Finalizing"];
const STAGE_TO_STEP: Record<string, number> = {
  Uploading: 0,
  Queued: 1,
  Analyzing: 1,
  "Detecting pauses": 2,
  Rendering: 3,
  Finalizing: 4,
};

const MAX_UPLOAD_MB = 500;

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: res.status === 413 ? "That file is too large to upload." : "Something went wrong." };
  }
}

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function UploadStudio({ credits, unlimited }: { credits: number; unlimited: boolean }) {
  const router = useRouter();
  const [creditsLeft, setCreditsLeft] = useState(credits);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<string>("balanced");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [stage, setStage] = useState<string>("Uploading");
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    try {
      const res = await fetch("/api/process?list=1");
      const data = await safeJson(res);
      if (Array.isArray(data.projects)) setProjects(data.projects);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function sendFeedback() {
    if (!rating) return;
    setFeedbackSent(true);
    try {
      await fetch("/api/process?feedback=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
    } catch {
      /* non-blocking */
    }
  }

  function pick(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name)) {
      setFile(null);
      setStatus("error");
      setError("That doesn't look like a video. Please upload an MP4, MOV, or similar video file.");
      return;
    }
    setFile(f);
    setStatus("idle");
    setError("");
    setResultUrl("");
    setStats(null);
    setRating(0);
    setComment("");
    setFeedbackSent(false);
  }

  const outOfCredits = !unlimited && creditsLeft <= 0;

  async function generate() {
    if (!file || outOfCredits) return;

    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > MAX_UPLOAD_MB) {
      setStatus("error");
      setError(
        `This video is ${sizeMb.toFixed(0)} MB, over the ${MAX_UPLOAD_MB} MB limit. ` +
          `Record or export in 1080p (not 4K), or use a shorter clip.`
      );
      return;
    }

    setStatus("working");
    setError("");
    setStage("Uploading");
    setQueued(false);
    try {
      const res = await fetch(
        `/api/process?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(file.name)}`,
        { method: "POST", headers: { "Content-Type": file.type || "video/mp4" }, body: file }
      );
      if (!res.ok) {
        const j = await safeJson(res);
        if (res.status === 402 || j.outOfCredits) {
          setCreditsLeft(0);
          router.refresh();
        }
        throw new Error(j.error || "Upload failed. Please try again.");
      }
      const start = await safeJson(res);
      const jobId = start.jobId;
      if (!jobId) throw new Error(start.error || "Upload failed. Please try again.");

      // Poll for real progress until done (up to ~12 minutes).
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        let data: any;
        try {
          const sres = await fetch(`/api/process?jobId=${jobId}`);
          data = await safeJson(sres);
        } catch {
          continue; // transient network blip — keep polling
        }
        if (data.stage) {
          setStage(data.stage);
          setQueued(data.stage === "Queued");
        }
        if (data.status === "error") throw new Error(data.error || "Processing failed.");
        if (!data.status && data.error) throw new Error(data.error);
        if (data.status === "done") {
          setStats(data.stats);
          const blob = await (await fetch(`/api/process?jobId=${jobId}&download=1`)).blob();
          setResultUrl(URL.createObjectURL(blob));
          setStatus("done");
          if (!unlimited) setCreditsLeft((c) => Math.max(0, c - 1));
          router.refresh();
          loadProjects();
          return;
        }
      }
      throw new Error("This is taking longer than expected. Please try again in a moment.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      // Map low-level network errors to a friendly message.
      const friendly = /failed to fetch|networkerror|load failed/i.test(msg)
        ? "Network problem — check your connection and try again."
        : msg;
      setError(friendly);
      setStatus("error");
    }
  }

  async function deleteProject(id: string) {
    setProjects((p) => p.filter((x) => x.id !== id));
    try {
      await fetch(`/api/process?jobId=${id}`, { method: "DELETE" });
    } catch {
      loadProjects();
    }
  }

  const working = status === "working";
  const activeStep = STAGE_TO_STEP[stage] ?? 0;
  const pct = Math.round(((activeStep + 1) / STEPS.length) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      {/* Editing mode selector */}
      <div className="mb-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Editing mode</p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={working}
              className={`rounded-xl border px-2 py-2.5 text-center transition disabled:opacity-50 ${
                mode === m.id
                  ? "border-indigo-400/60 bg-indigo-500/15 text-white"
                  : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
              }`}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-[10px] text-white/40">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Dropzone */}
      <div
        onClick={() => !working && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!working) pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className="glass cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center transition hover:border-indigo-400/40"
      >
        <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </div>
        {file ? <p className="mt-4 font-medium">{file.name}</p> : <p className="mt-4 text-white/60">Click to choose a video, or drag one here</p>}
        {file && (
          <p className={`mt-1 text-sm ${file.size / 1024 / 1024 > MAX_UPLOAD_MB ? "text-red-300" : "text-white/40"}`}>
            {(file.size / 1024 / 1024).toFixed(1)} MB
            {file.size / 1024 / 1024 > MAX_UPLOAD_MB && ` — too large (max ~${MAX_UPLOAD_MB} MB)`}
          </p>
        )}
        {!file && <p className="mt-1 text-xs text-white/30">MP4 or MOV · up to ~{MAX_UPLOAD_MB} MB · record in 1080p for best speed</p>}
      </div>

      {/* Out of credits */}
      {outOfCredits ? (
        <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-center">
          <p className="font-medium text-amber-200">You&apos;ve used all your free edits.</p>
          <p className="mt-1 text-sm text-white/60">Upgrade to keep cleaning videos with TrimIQ.</p>
          <Link href="/#pricing" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 font-medium transition hover:opacity-90">
            View plans
          </Link>
        </div>
      ) : (
        <>
          <button
            onClick={generate}
            disabled={!file || working}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3.5 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working ? "Editing…" : "Generate Clean Edit"}
          </button>
          {!unlimited && (
            <p className="mt-2 text-center text-xs text-white/40">
              {creditsLeft} free {creditsLeft === 1 ? "edit" : "edits"} left
            </p>
          )}
        </>
      )}

      {/* Processing screen — driven by real server stages */}
      {working && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="font-medium text-white/80">
              {queued ? "Waiting in queue…" : `${stage}…`}
            </span>
            <span className="text-white/40">{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-5 space-y-3">
            {STEPS.map((label, i) => {
              const state = i < activeStep ? "done" : i === activeStep ? "active" : "pending";
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                    state === "done" ? "bg-emerald-500/20 text-emerald-300"
                      : state === "active" ? "bg-indigo-500/20 text-indigo-200"
                      : "bg-white/5 text-white/30"
                  }`}>
                    {state === "done" ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    ) : state === "active" ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300/40 border-t-indigo-200" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                    )}
                  </span>
                  <span className={`text-sm ${state === "pending" ? "text-white/40" : "text-white/80"}`}>{label}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-white/30">Larger or longer videos take a little more time — you can keep this tab open.</p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {/* Result + statistics */}
      {status === "done" && stats && (
        <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-6">
          <p className="font-medium text-emerald-300">Your clean edit is ready.</p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Cuts made" value={String(stats.cuts)} />
            <Stat label="Time removed" value={`${stats.removed.toFixed(1)}s`} highlight />
            <Stat label="Dead space" value={`${stats.percent}%`} highlight />
            <Stat label="Original" value={`${stats.original.toFixed(1)}s`} />
            <Stat label="Final" value={`${stats.cleaned.toFixed(1)}s`} />
            <Stat label="Time saved" value={`${stats.removed.toFixed(1)}s`} />
          </div>

          {stats.capped && (
            <p className="mt-3 text-xs text-white/40">
              This was a 4K video — exported at 1080p (TikTok&apos;s maximum) so it processes reliably. It looks identical when posted.
            </p>
          )}

          {resultUrl && (
            <>
              <video src={resultUrl} controls className="mx-auto mt-5 w-full rounded-xl" style={{ maxHeight: "70vh", objectFit: "contain", background: "#000" }} />
              <a href={resultUrl} download={`${(file?.name || "video").replace(/\.[^.]+$/, "")}-trimiq.mp4`} className="mt-4 block rounded-xl bg-white py-3 text-center font-medium text-ink transition hover:bg-white/90">
                Download clean video
              </a>
            </>
          )}

          {/* Beta feedback */}
          <div className="mt-6 border-t border-white/10 pt-5">
            {feedbackSent ? (
              <p className="text-sm text-emerald-300">Thanks for the feedback — it really helps. 🙏</p>
            ) : (
              <>
                <p className="text-sm font-medium text-white/80">How was this edit?</p>
                <div className="mt-2 flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      className={`text-2xl leading-none transition ${n <= rating ? "text-amber-300" : "text-white/25 hover:text-white/50"}`}>
                      ★
                    </button>
                  ))}
                </div>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything we should improve? (optional)" rows={2}
                  className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/50 focus:outline-none" />
                <button type="button" onClick={sendFeedback} disabled={!rating}
                  className="mt-3 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">
                  Send feedback
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Recent projects (this session) */}
      {projects.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-white/40">Recent projects</h2>
            <span className="text-xs text-white/30">available this session</span>
          </div>
          <div className="space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="glass flex items-center gap-3 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/90">{p.name}</p>
                  <p className="text-xs text-white/40">
                    {fmtDate(p.createdAt)}
                    {p.status === "done" && p.stats ? ` · ${p.stats.removed.toFixed(1)}s removed` : ""}
                  </p>
                </div>
                {p.status === "processing" && (
                  <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-200">Processing…</span>
                )}
                {p.status === "error" && (
                  <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-200">Failed</span>
                )}
                {p.status === "done" && (
                  <a href={`/api/process?jobId=${p.id}&download=1`}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15">
                    Download
                  </a>
                )}
                <button onClick={() => deleteProject(p.id)} aria-label="Delete project"
                  className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/5 hover:text-red-300">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${highlight ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}
