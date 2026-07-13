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
  segments?: [number, number][];
  words?: { t: string; s: number; e: number; x: boolean }[];
  keptText?: string;
  fillerRemoved?: number;
  stageMs?: Record<string, number>;
  engine?: string;
  model?: string;
  engineVersion?: string;
  captions?: { color: string; size: string; position: string; count: number; coverage: number } | null;
  zooms?: { count: number; intensity: string; frequency: string; notes?: string[] } | null;
};

type Project = {
  batchId?: string;
  downloadable?: boolean;
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
  file: File | null;
  status: QStatus;
  stage: string;
  error: string;
  resultUrl: string;
  stats: Stats | null;
  jobId: string;
  mode: string;
  applied: string[];
};

const MODES = [
  { id: "beginner", label: "Beginner", desc: "Safe, minimal cuts" },
  { id: "balanced", label: "Balanced", desc: "Recommended" },
  { id: "aggressive", label: "Aggressive", desc: "Max pace" },
] as const;

const CHIPS = ["Don't cut the intro", "Keep my pauses", "Cut harder", "Target 30 seconds", "Add captions", "Make the captions blue", "Add subtle zooms", "Zoom on the key moments", "Make it energetic", "TikTok Shop style"];

function fmtSecs(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
function track(name: string, props?: Record<string, unknown>) {
  try {
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, props }) }).catch(() => {});
  } catch {}
}

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
  const [instructions, setInstructions] = useState("");
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionColor, setCaptionColor] = useState("white");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plan, setPlan] = useState<{ id: string; name: string; batchSize: number; maxUploadMB: number; captions: boolean; instructions: boolean; zooms: boolean; bulkDownload: boolean } | null>(null);
  const [unacked, setUnacked] = useState<string[]>([]);
  const [supportReplies, setSupportReplies] = useState<{ id: string; message: string; reply: string }[]>([]);
  const [notice, setNotice] = useState("");
  const batchRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    try {
      const res = await fetch("/api/process?list=1");
      const data = await safeJson(res);
      if (Array.isArray(data.projects)) setProjects(data.projects);
      if (data.plan) setPlan(data.plan);
      if (Array.isArray(data.unackedBatches)) setUnacked(data.unackedBatches);
      if (Array.isArray(data.supportReplies)) setSupportReplies(data.supportReplies);
      if (typeof data.creditsLeft === "number") setCreditsLeft(data.creditsLeft);
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    loadProjects();
  }, []);

  // The server keeps processing when the tab closes; while it\u2019s open we
  // poll for statuses, credits and batch-completion notifications.
  useEffect(() => {
    const iv = setInterval(loadProjects, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    batchRef.current = `b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    setRating(0);
    setComment("");
    setFeedbackSent(false);
  }

  const outOfCredits = !unlimited && creditsLeft <= 0;

  function patch(id: string, p: Partial<QItem>) {
    setQueue((qs) => qs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function finishJob(item: QItem, res: Response) {
    if (!res.ok) {
      const j = await safeJson(res);
      if (res.status === 402 || j.outOfCredits) {
        setCreditsLeft(0);
        router.refresh();
      }
      throw new Error(j.error || "Upload failed. Please try again.");
    }
    const start = await safeJson(res);
    if (Array.isArray(start.locked) && start.locked.length) setNotice(start.locked.join(" "));
    const jobId = start.jobId;
    if (!jobId) throw new Error(start.error || "Upload failed. Please try again.");
    patch(item.id, { status: "processing", jobId, applied: Array.isArray(start.applied) ? start.applied : [] });

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
        patch(item.id, {
          status: "done", stage: "Done", resultUrl: URL.createObjectURL(blob),
          stats: data.stats, mode: data.mode || "balanced",
        });
        if (!unlimited) setCreditsLeft((c) => Math.max(0, c - 1));
        router.refresh();
        return;
      }
    }
    throw new Error("This is taking longer than expected. Please try again.");
  }

  function friendlyMsg(e: unknown): string {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    return /failed to fetch|networkerror|load failed/i.test(msg)
      ? "Network problem — check your connection and try again."
      : msg;
  }

  async function processOne(item: QItem, onSuccess: () => void) {
    patch(item.id, { status: "uploading", stage: "Uploading", error: "" });
    try {
      if (!item.file) throw new Error("Missing file.");
      if (item.file.size / 1024 / 1024 > (plan?.maxUploadMB ?? MAX_UPLOAD_MB)) {
        patch(item.id, { status: "error", error: `Too large (max ~${MAX_UPLOAD_MB} MB). Use 1080p, not 4K.` });
        return;
      }
      if (instructions.trim()) track("instructions_used");
      const res = await fetch(
        `/api/process?mode=${encodeURIComponent(mode)}&batch=${encodeURIComponent(batchRef.current)}&name=${encodeURIComponent(item.file.name)}&instructions=${encodeURIComponent(instructions.trim().slice(0, 500))}${captionsOn ? `&captions=1&capcolor=${captionColor}` : ""}`,
        { method: "POST", headers: { "Content-Type": item.file.type || "video/mp4" }, body: item.file }
      );
      await finishJob(item, res);
      onSuccess();
    } catch (e) {
      patch(item.id, { status: "error", error: friendlyMsg(e) });
    }
  }

  // Regenerate a finished edit with different settings — no re-upload needed.
  async function regenerate(fromItem: QItem, newMode: string, newInstructions: string) {
    if (busy || !fromItem.jobId) return;
    track("reedit_clicked", { mode: newMode });
    const item: QItem = {
      id: `${Date.now()}-re`, name: fromItem.name, file: null,
      status: "uploading", stage: "Starting", error: "", resultUrl: "",
      stats: null, jobId: "", mode: newMode, applied: [],
    };
    setQueue([item]);
    setBusy(true);
    setFeedbackSent(false);
    try {
      const res = await fetch(
        `/api/process?reedit=${encodeURIComponent(fromItem.jobId)}&mode=${encodeURIComponent(newMode)}&name=${encodeURIComponent(fromItem.name)}&instructions=${encodeURIComponent(newInstructions.trim().slice(0, 500))}`,
        { method: "POST" }
      );
      await finishJob(item, res);
    } catch (e) {
      patch(item.id, { status: "error", error: friendlyMsg(e) });
    }
    setBusy(false);
    loadProjects();
  }

  async function startOne(item: QItem): Promise<string | null> {
    patch(item.id, { status: "uploading", stage: "Uploading", error: "" });
    try {
      if (!item.file) throw new Error("Missing file.");
      if (item.file.size / 1024 / 1024 > (plan?.maxUploadMB ?? MAX_UPLOAD_MB)) {
        patch(item.id, { status: "error", error: `Too large (max ${plan?.maxUploadMB ?? MAX_UPLOAD_MB} MB on your plan).` });
        return null;
      }
      if (instructions.trim()) track("instructions_used");
      const res = await fetch(
        `/api/process?mode=${encodeURIComponent(mode)}&batch=${encodeURIComponent(batchRef.current)}&name=${encodeURIComponent(item.file.name)}&instructions=${encodeURIComponent(instructions.trim())}${captionsOn ? `&captions=1&capcolor=${captionColor}` : ""}`,
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
      if (!start.jobId) throw new Error(start.error || "Upload failed. Please try again.");
      if (Array.isArray(start.locked) && start.locked.length) setNotice(start.locked.join(" "));
      patch(item.id, {
        status: "processing", stage: "Queued", jobId: start.jobId,
        applied: Array.isArray(start.applied) ? start.applied : [],
      });
      return start.jobId;
    } catch (e) {
      patch(item.id, { status: "error", error: friendlyMsg(e) });
      return null;
    }
  }

  async function watchOne(item: QItem, jobId: string) {
    for (let i = 0; i < 600; i++) {
      await sleep(2000);
      let data: any;
      try {
        const s = await fetch(`/api/process?jobId=${jobId}`);
        data = await safeJson(s);
      } catch {
        continue;
      }
      if (data.stage) patch(item.id, { stage: data.stage });
      if (data.status === "error") {
        patch(item.id, { status: "error", error: data.error || "Processing failed." });
        return;
      }
      if (data.status === "done") {
        try {
          const blob = await (await fetch(`/api/process?jobId=${jobId}&download=1`)).blob();
          patch(item.id, { status: "done", stage: "Done", resultUrl: URL.createObjectURL(blob), stats: data.stats, mode: data.mode || "balanced" });
        } catch {
          patch(item.id, { status: "done", stage: "Done", stats: data.stats });
        }
        if (!unlimited) setCreditsLeft((c) => Math.max(0, c - 1));
        return;
      }
    }
  }

  async function ackReply(id: string) {
    setSupportReplies((rs) => rs.filter((r) => r.id !== id));
    fetch(`/api/process?ackReply=${encodeURIComponent(id)}`, { method: "POST" }).catch(() => {});
  }

  async function ackBatchClick(b: string) {
    setUnacked((u) => u.filter((x) => x !== b));
    fetch(`/api/process?ackBatch=${encodeURIComponent(b)}`, { method: "POST" }).catch(() => {});
  }

  async function downloadBatch(items: { id: string; name: string }[]) {
    for (const p of items) {
      const a = document.createElement("a");
      a.href = `/api/process?jobId=${p.id}&download=1`;
      a.download = `trimiq-${p.name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await sleep(600);
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
      jobId: "",
      mode,
      applied: [],
    }));
    setQueue(q);
    setBusy(true);
    setFeedbackSent(false);

    // Batch cap + credit guard client-side (the server enforces both too).
    const cap = plan?.batchSize ?? 2;
    let allowed = q.slice(0, cap);
    for (const item of q.slice(cap)) {
      patch(item.id, { status: "error", error: `Your plan allows ${cap} videos per batch - upgrade for bigger batches.` });
    }
    if (!unlimited) {
      for (const item of allowed.slice(Math.max(0, creditsLeft))) {
        patch(item.id, { status: "error", error: "Out of edits - upgrade to keep going." });
      }
      allowed = allowed.slice(0, Math.max(0, creditsLeft));
    }

    // Phase 1 - upload everything up-front (2 at a time). Once uploaded the
    // SERVER queue owns the batch: closing this tab doesn't stop processing.
    const started: { item: QItem; jobId: string }[] = [];
    let cursor = 0;
    const uploadNext = async (): Promise<void> => {
      const item = allowed[cursor++];
      if (!item) return;
      const jobId = await startOne(item);
      if (jobId) started.push({ item, jobId });
      return uploadNext();
    };
    await Promise.all([uploadNext(), uploadNext()]);

    // Phase 2 - watch progress (cosmetic: processing continues without us).
    await Promise.all(started.map(({ item, jobId }) => watchOne(item, jobId).catch(() => {})));
    setBusy(false);
    loadProjects();
  }

  async function deleteProject(id: string) {
    setProjects((p) => p.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/process?jobId=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await safeJson(res);
        setNotice(j.error || "Couldn't delete that project - please try again.");
        loadProjects();
      }
    } catch {
      loadProjects();
    }
  }

  // Remove a failed upload/edit card from the current batch view (and its
  // server record, if one was created).
  function dismissFailed(item: QItem) {
    setQueue((qs) => qs.filter((x) => x.id !== item.id));
    if (item.jobId) fetch(`/api/process?jobId=${item.jobId}`, { method: "DELETE" }).catch(() => {});
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

      {/* AI Edit Instructions (optional) */}
      <div className="mb-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Edit instructions <span className="normal-case text-white/25">(optional)</span>
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={busy}
          rows={2}
          maxLength={500}
          placeholder="Tell TrimIQ how to edit — e.g. Don't cut the intro. Target 30 seconds."
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/50 focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button key={c} type="button" disabled={busy}
              onClick={() => setInstructions((v) => (v ? v + " " + c + "." : c + "."))}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/55 transition hover:border-indigo-400/40 hover:text-white disabled:opacity-40">
              + {c}
            </button>
          ))}
        </div>
        {/* Explicit caption toggle (also reachable via instructions) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !!(plan && !plan.captions)} title={plan && !plan.captions ? "Auto captions are available on Starter and up" : undefined} onClick={() => setCaptionsOn((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${captionsOn ? "border-indigo-400/50 bg-indigo-500/15 text-white" : "border-white/10 text-white/50 hover:text-white"} disabled:opacity-40`}>
            {captionsOn ? "\u2713 " : ""}Auto captions
          </button>
          {captionsOn && ["white", "yellow", "blue", "green", "pink"].map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => setCaptionColor(c)} aria-label={`${c} captions`}
              className={`h-6 w-6 rounded-full border-2 transition ${captionColor === c ? "border-indigo-400" : "border-white/15"}`}
              style={{ background: c === "white" ? "#fff" : c === "yellow" ? "#FFD400" : c === "blue" ? "#3DA5FF" : c === "green" ? "#3DFF88" : "#FF6BD6" }} />
          ))}
          {captionsOn && <span className="text-[10px] text-white/35">bold TikTok-style, burned in</span>}
        </div>
      </div>

      {/* Support reply notification */}
      {supportReplies.map((r) => (
        <div key={r.id} className="mb-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-indigo-200">Reply from TrimIQ support</p>
          <p className="mt-1 text-white/75">{r.reply}</p>
          <p className="mt-1 text-[11px] text-white/35">Re: {r.message}</p>
          <button type="button" onClick={() => ackReply(r.id)} className="mt-2 text-xs text-indigo-200/60 transition hover:text-indigo-100">
            Dismiss
          </button>
        </div>
      ))}

      {/* Batch-completion notification */}
      {unacked
        .filter((b) => {
          const items = projects.filter((p) => p.batchId === b);
          return items.length > 0 && items.every((p) => p.status === "done" || p.status === "error");
        })
        .slice(0, 1)
        .map((b) => {
          const items = projects.filter((p) => p.batchId === b);
          const ok = items.filter((p) => p.status === "done");
          return (
            <div key={b} className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm">
              <span className="font-medium text-emerald-200">
                Your batch is ready - {ok.length} of {items.length} video{items.length === 1 ? "" : "s"} completed.
              </span>
              {plan?.bulkDownload && ok.length > 0 && (
                <button type="button" onClick={() => downloadBatch(ok)} className="rounded-lg bg-emerald-500/20 px-3 py-1 font-medium text-emerald-100 transition hover:bg-emerald-500/30">
                  Download all
                </button>
              )}
              <button type="button" onClick={() => ackBatchClick(b)} className="ml-auto text-emerald-200/60 transition hover:text-emerald-100">
                Dismiss
              </button>
            </div>
          );
        })}
      {notice && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {notice}
          <button type="button" onClick={() => setNotice("")} className="ml-3 text-amber-200/60 transition hover:text-amber-100">
            Dismiss
          </button>
        </div>
      )}

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
        <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error"
            className="shrink-0 rounded-lg px-1.5 text-red-200/60 transition hover:text-red-100">
            ✕
          </button>
        </div>
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
                {item.status === "error" && (
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <p className="text-xs text-red-300">{item.error}</p>
                    <button type="button" onClick={() => dismissFailed(item)}
                      className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 transition hover:border-red-400/40 hover:text-red-300">
                      Delete
                    </button>
                  </div>
                )}
                {item.status === "done" && item.stats && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span>{item.stats.cuts} cuts</span>
                    <span>·</span>
                    <span className="text-emerald-300">{item.stats.removed.toFixed(1)}s removed</span>
                    <span>·</span>
                    <span>{item.stats.original.toFixed(0)}s → {item.stats.cleaned.toFixed(0)}s</span>
                    <a
                      href={`/api/process?jobId=${item.jobId}&download=1`}
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

      {/* Review experience for a single finished edit */}
      {single && doneItems[0].resultUrl && doneItems[0].stats && (
        <ReviewPanel item={doneItems[0]} busy={busy} onRegenerate={regenerate} />
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
            <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-white/40">Recent projects</h2>
            {plan?.bulkDownload && projects.some((p) => p.downloadable) && (
              <button type="button" onClick={() => downloadBatch(projects.filter((p) => p.downloadable))} className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/70 transition hover:bg-white/10">
                Download all completed
              </button>
            )}
          </div>
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

// ─── Review panel: everything the AI improved, at a glance. Sections are
// stacked and independent so future editing features slot in without a
// redesign (add a new bordered block). ───
function ReviewPanel({ item, busy, onRegenerate }: {
  item: QItem; busy: boolean; onRegenerate: (item: QItem, mode: string, instructions: string) => void;
}) {
  const s = item.stats!;
  const [showOriginal, setShowOriginal] = useState(false);
  const [reMode, setReMode] = useState<string>(item.mode || "balanced");
  const [reInstructions, setReInstructions] = useState("");
  const words = s.words || [];
  const fillerSeconds = words.reduce((t, w) => (w.x ? t + (w.e - w.s) : t), 0);
  const silenceSeconds = Math.max(0, s.removed - fillerSeconds);
  const processMs = Object.values(s.stageMs || {}).reduce((a, b) => a + b, 0);
  const originalUrl = item.jobId ? `/api/process?jobId=${item.jobId}&original=1` : "";
  const styleLabel = (MODES.find((m) => m.id === item.mode) || MODES[1]).label;

  useEffect(() => {
    track("preview_viewed", { mode: item.mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="glass mt-6 overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <p className="font-semibold text-white">Your edit is ready ✨</p>
          <p className="mt-0.5 text-xs text-white/40">
            {styleLabel} style · processed in {fmtSecs(processMs / 1000)} · engine v{s.engineVersion || "—"}
          </p>
        </div>
        <a href={`/api/process?jobId=${item.jobId}&download=1`} download={`${item.name.replace(/\.[^.]+$/, "")}-trimiq.mp4`}
          onClick={() => track("download_clicked", { mode: item.mode })}
          className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/45">
          Download
        </a>
      </div>

      <div className="p-4">
        <div className="mb-3 flex justify-center">
          <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
            <button onClick={() => setShowOriginal(false)}
              className={`rounded-lg px-4 py-1.5 text-xs font-medium transition ${!showOriginal ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"}`}>
              ✨ Edited · {fmtSecs(s.cleaned)}
            </button>
            <button onClick={() => setShowOriginal(true)} disabled={!originalUrl}
              className={`rounded-lg px-4 py-1.5 text-xs font-medium transition ${showOriginal ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"} disabled:opacity-40`}>
              Original · {fmtSecs(s.original)}
            </button>
          </div>
        </div>
        <video key={showOriginal ? "o" : "e"} src={showOriginal ? originalUrl : item.resultUrl} controls
          className="mx-auto w-full rounded-xl" style={{ maxHeight: "60vh", objectFit: "contain", background: "#000" }} />

        {s.segments && s.segments.length > 0 && s.original > 0 && (
          <div className="mt-3">
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-red-500/25">
              {s.segments.map(([a, b], i) => (
                <div key={i} className="absolute top-0 h-full bg-emerald-400/80"
                  style={{ left: `${(a / s.original) * 100}%`, width: `${Math.max(0.5, ((b - a) / s.original) * 100)}%` }} />
              ))}
            </div>
            <p className="mt-1 text-center text-[10px] text-white/35">green = kept · red = removed by TrimIQ</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/5 sm:grid-cols-4">
        <Metric label="Cuts made" value={String(s.cuts)} />
        <Metric label="Silence removed" value={fmtSecs(silenceSeconds)} />
        <Metric label="Fillers removed" value={String(s.fillerRemoved ?? 0)} sub="um, uh, like…" />
        <Metric label="Time saved" value={fmtSecs(s.removed)} accent />
        <Metric label="Editing style" value={styleLabel} />
        <Metric label="Captions" value={s.captions ? `${s.captions.color} \u00b7 ${s.captions.size}` : "Off"} sub={s.captions ? `${s.captions.count} lines \u00b7 ${s.captions.position}` : "toggle captions or say: add captions"} dim={!s.captions} />
        <Metric label="Zoom effects" value={s.zooms ? `${s.zooms.count} ${s.zooms.count === 1 ? "zoom" : "zooms"} · ${s.zooms.intensity}` : "Off"} sub={s.zooms ? (s.zooms.notes && s.zooms.notes.length ? s.zooms.notes.join(" ") : "TrimIQ-picked moments") : "say: add zooms / make it energetic"} dim={!s.zooms} />
        <Metric label="Processing time" value={fmtSecs(processMs / 1000)} />
        <Metric label="Engine" value={s.engine === "smart" ? "Transcript-based" : "Audio-based"} sub={s.model || undefined} />
      </div>

      {item.applied.length > 0 && (
        <div className="border-t border-white/10 p-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-white/40">Your instructions, applied</p>
          <div className="flex flex-wrap gap-1.5">
            {item.applied.map((a) => (
              <span key={a} className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">✓ {a}</span>
            ))}
          </div>
        </div>
      )}

      {words.length > 0 && (
        <details className="border-t border-white/10 p-4">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-white/40">
            Transcript · struck-through words were removed
          </summary>
          <p className="mt-3 max-h-48 overflow-y-auto text-sm leading-relaxed text-white/70">
            {words.map((w, i) =>
              w.x
                ? <s key={i} className="mx-0.5 text-red-300/60">{w.t}</s>
                : <span key={i} className="mx-0.5">{w.t}</span>
            )}
          </p>
        </details>
      )}

      <div className="border-t border-white/10 p-4">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-white/40">
          Not quite right? Regenerate with different settings — no re-upload needed
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setReMode(m.id)} disabled={busy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${reMode === m.id ? "bg-indigo-500/30 text-white" : "text-white/50 hover:text-white"} disabled:opacity-40`}>
                {m.label}
              </button>
            ))}
          </div>
          <input value={reInstructions} onChange={(e) => setReInstructions(e.target.value)} disabled={busy} maxLength={500}
            placeholder="Optional instructions…"
            className="min-w-[10rem] flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-indigo-400/50 focus:outline-none disabled:opacity-50" />
          <button onClick={() => onRegenerate(item, reMode, reInstructions)} disabled={busy}
            className="rounded-xl border border-indigo-400/40 bg-indigo-500/10 px-4 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20 disabled:opacity-40">
            ↻ Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, accent, dim }: { label: string; value: string; sub?: string; accent?: boolean; dim?: boolean }) {
  return (
    <div className="bg-ink p-3.5 text-center">
      <div className="text-[10px] font-medium uppercase tracking-wide text-white/35">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-tight ${accent ? "text-emerald-300" : dim ? "text-white/35" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/30">{sub}</div>}
    </div>
  );
}
