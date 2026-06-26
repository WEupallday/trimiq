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

type QStatus = "pending" | "uploading" | "processing" | "done" | "error";
type QItem = {
  id: string;
  name: string;
  file: File;
  status: QStatus;
  stage: string;
  error: string;
  resultUrl: string;
  stats: Stats | null;
};

const MODES = [
  { id: "light", label: "Light", desc: "Minimal cuts" },
  { id: "balanced", label: "Balanced", desc: "Recommended" },
  { id: "aggressive", label: "Aggressive", desc: "Max trimming" },
] as const;

const STAGE_PCT: Record<string, number> = {
  Uploading: 15,
  Queued: 25,
  Analyzing: 40,
  "Detecting pauses": 60,
  Rendering: 80,
  Finalizing: 95,
  Done: 100,
};

const MAX_UPLOAD_MB = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function isVideo(f: File) {
  return f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name);
}

export default function UploadStudio({ credits, unlimited }: { credits: number; unlimited: boolean }) {
  const router = useRouter();
  const [creditsLeft, setCreditsLeft] = useState(credits);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<string>("balanced");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [error, setError] = useState("");
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

  function pick(list: FileList | null) {
    if (!list || !list.length) return;
    const all = Array.from(list);
    const vids = all.filter(isVideo);
    if (!vids.length) {
      setError("Those don't look like videos. Please upload MP4, MOV, or similar video files.");
      return;
    }
    setError(vids.length < all.length ? "Some files were skipped (not videos)." : "");
    setFiles(vids);
    setQueue([]);
    setRating(0);
    setComment("");
    setFeedbackSent(false);
  }

  const outOfCredits = !unlimited && creditsLeft <= 0;

  function patch(id: string, p: Partial<QItem>) {
    setQueue((qs) => qs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function processOne(item: QItem, onSuccess: () => void) {
    patch(item.id, { status: "uploading", stage: "Uploading", error: "" });
    try {
      if (item.file.size / 1024 / 1024 > MAX_UPLOAD_MB) {
        patch(item.id, { status: "error", error: `Too large (max ~${MAX_UPLOAD_MB} MB). Use 1080p, not 4K.` });
        return;
      }
      const res = await fetch(
        `/api/process?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(item.file.name)}`,
        { method: "POST", headers: { "Content-Type": item.file.type || "video/mp4" }, body: item.file }
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
      patch(item.id, { status: "processing" });

      for (let i = 0; i < 300; i++) {
        await sleep(2000);
        let data: any;
        try {
          const s = await fetch(`/api/process?jobId=${jobId}`);
          data = await safeJson(s);
        } catch {
          continue;
        }
        if (data.stage) patch(item.id, { stage: data.stage });
        if (data.status === "error") throw new Error(data.error || "Processing failed.");
        if (!data.status && data.error) throw new Error(data.error);
        if (data.status === "done") {
          const blob = await (await fetch(`/api/process?jobId=${jobId}&download=1`)).blob();
          patch(item.id, { status: "done", stage: "Done", resultUrl: URL.createObjectURL(blob), stats: data.stats });
          if (!unlimited) setCreditsLeft((c) => Math.max(0, c - 1));
          onSuccess();
          router.refresh();
          return;
        }
      }
      throw new Error("This is taking longer than expected. Please try again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      const friendly = /failed to fetch|networkerror|load failed/i.test(msg)
        ? "Network problem — check your connection and try again."
        : msg;
      patch(item.id, { status: "error", error: friendly });
    }
  }

  async function generate() {
    if (!files.length || outOfCredits || busy) return;
    setError("");
    const q: QItem[] = files.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      name: f.name,
      file: f,
      status: "pending",
      stage: "",
      error: "",
      resultUrl: "",
      stats: null,
    }));
    setQueue(q);
    setBusy(true);
    setFeedbackSent(false);

    let localCredits = creditsLeft;
    for (const item of q) {
      if (!unlimited && localCredits <= 0) {
        patch(item.id, { status: "error", error: "Out of edits — upgrade to keep going." });
        continue;
      }
      await processOne(item, () => {
        localCredits -= 1;
      });
    }
    setBusy(false);
    loadProjects();
  }

  async function deleteProject(id: string) {
    setProjects((p) => p.filter((x) => x.id !== id));
    try {
      await fetch(`/api/process?jobId=${id}`, { method: "DELETE" });
    } catch {
      loadProjects();
    }
  }

  const doneItems = queue.filter((q) => q.status === "done");
  const allFinished = queue.length > 0 && !busy && queue.every((q) => q.status === "done" || q.status === "error");
  const single = doneItems.length === 1 && queue.length === 1;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Editing mode */}
      <div className="mb-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Editing mode</p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              disabled={busy}
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

      {/* Dropzone (multiple) */}
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) pick(e.dataTransfer.files);
        }}
        className="glass cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center transition hover:border-indigo-400/40"
      >
        <input ref={inputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </div>
        {files.length === 0 ? (
          <p className="mt-4 text-white/60">Click to choose videos, or drag them here</p>
        ) : files.length === 1 ? (
          <p className="mt-4 font-medium">{files[0].name}</p>
        ) : (
          <p className="mt-4 font-medium">{files.length} videos selected</p>
        )}
        {files.length === 0 && <p className="mt-1 text-xs text-white/30">MP4 or MOV · up to ~{MAX_UPLOAD_MB} MB each · select several for batch editing</p>}
      </div>

      {/* Out of credits */}
      {outOfCredits ? (
        <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-center">
          <p className="font-medium text-amber-200">You&apos;ve used all your edits.</p>
          <p className="mt-1 text-sm text-white/60">Upgrade to keep cleaning videos with TrimIQ.</p>
          <Link href="/#pricing" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-6 py-3 font-medium transition hover:opacity-90">
            View plans
          </Link>
        </div>
      ) : (
        <>
          <button
            onClick={generate}
            disabled={!files.length || busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3.5 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Editing…" : files.length > 1 ? `Generate ${files.length} Clean Edits` : "Generate Clean Edit"}
          </button>
          {!unlimited && (
            <p className="mt-2 text-center text-xs text-white/40">
              {creditsLeft} {creditsLeft === 1 ? "edit" : "edits"} left
            </p>
          )}
        </>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div className="mt-6 space-y-3">
          {queue.map((item) => {
            const pct = item.status === "done" ? 100 : item.status === "error" ? 0 : STAGE_PCT[item.stage] ?? 10;
            const active = item.status === "uploading" || item.status === "processing";
            return (
              <div key={item.id} className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <span className="shrink-0 text-xs text-white/40">
                    {item.status === "pending" && "Waiting"}
                    {active && (item.stage || "Working") + "…"}
                    {item.status === "done" && "Done"}
                    {item.status === "error" && "Failed"}
                  </span>
                </div>
                {item.status !== "error" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full transition-all duration-700 ${item.status === "done" ? "bg-emerald-400" : "bg-gradient-to-r from-indigo-500 to-fuchsia-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                {item.status === "error" && <p className="mt-2 text-xs text-red-300">{item.error}</p>}
                {item.status === "done" && item.stats && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span>{item.stats.cuts} cuts</span>
                    <span>·</span>
                    <span className="text-emerald-300">{item.stats.removed.toFixed(1)}s removed</span>
                    <span>·</span>
                    <span>{item.stats.original.toFixed(0)}s → {item.stats.cleaned.toFixed(0)}s</span>
                    <a
                      href={item.resultUrl}
                      download={`${item.name.replace(/\.[^.]+$/, "")}-trimiq.mp4`}
                      className="ml-auto rounded-lg bg-white px-3 py-1.5 font-medium text-ink transition hover:bg-white/90"
                    >
                      Download
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Single-file preview */}
      {single && doneItems[0].resultUrl && (
        <video src={doneItems[0].resultUrl} controls className="mx-auto mt-4 w-full rounded-xl" style={{ maxHeight: "70vh", objectFit: "contain", background: "#000" }} />
      )}

      {/* Feedback after batch completes */}
      {allFinished && doneItems.length > 0 && (
        <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-5">
          {feedbackSent ? (
            <p className="text-sm text-emerald-300">Thanks for the feedback — it really helps. 🙏</p>
          ) : (
            <>
              <p className="text-sm font-medium text-white/80">How were these edits?</p>
              <div className="mt-2 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}
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
      )}

      {/* Recent projects */}
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
                {p.status === "processing" && <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-200">Processing…</span>}
                {p.status === "error" && <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-200">Failed</span>}
                {p.status === "done" && (
                  <a href={`/api/process?jobId=${p.id}&download=1`} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15">
                    Download
                  </a>
                )}
                <button onClick={() => deleteProject(p.id)} aria-label="Delete project" className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/5 hover:text-red-300">
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
