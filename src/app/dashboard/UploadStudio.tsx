"use client";

import { useRef, useState } from "react";

type Stats = {
  original: number;
  cleaned: number;
  removed: number;
  cuts: number;
  percent: number;
  capped: boolean;
};

const MODES = [
  { id: "light", label: "Light", desc: "Minimal cuts" },
  { id: "balanced", label: "Balanced", desc: "Recommended" },
  { id: "aggressive", label: "Aggressive", desc: "Max trimming" },
] as const;

const STEPS = ["Uploading", "Analyzing", "Detecting pauses", "Cleaning video", "Rendering", "Finalizing"];

// Hosting proxy rejects uploads larger than this (returns an HTML error page).
const MAX_UPLOAD_MB = 100;

// Parse a response as JSON, but never throw on an HTML error page (e.g. a 413
// from the proxy) — return a friendly object instead.
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: res.status === 413 ? "That file is too large to upload." : "Upload failed." };
  }
}

export default function UploadStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<string>("balanced");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function pick(f: File | null) {
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setError("");
    setResultUrl("");
    setStats(null);
  }

  function startSteps() {
    setStep(0);
    timerRef.current = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 1800);
  }
  function stopSteps() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function generate() {
    if (!file) return;

    // The hosting platform rejects uploads larger than ~100 MB before they reach
    // the editor. Catch that here with a clear message instead of a failed upload.
    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > MAX_UPLOAD_MB) {
      setError(
        `This video is ${sizeMb.toFixed(0)} MB, which is too large to upload (limit is about ${MAX_UPLOAD_MB} MB). ` +
          `Record or export in 1080p instead of 4K, or use a shorter clip — that keeps files well under the limit.`
      );
      setStatus("error");
      return;
    }

    setStatus("working");
    setError("");
    startSteps();
    try {
      // 1) Upload the raw file. The server starts editing in the background and
      //    returns a job id right away, so this request stays short.
      const res = await fetch(`/api/process?mode=${encodeURIComponent(mode)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(
          j.error || (res.status === 413 ? "That file is too large to upload." : "Upload failed.")
        );
      }
      const start = await safeJson(res);
      const jobId = start.jobId;
      if (!jobId) throw new Error(start.error || "Upload failed.");

      // 2) Poll until the edit is done (up to ~12 minutes).
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const sres = await fetch(`/api/process?jobId=${jobId}`);
        const data = await safeJson(sres);
        if (data.status === "error") throw new Error(data.error || "Processing failed.");
        if (data.status === "done") {
          setStats({
            original: data.stats.original,
            cleaned: data.stats.cleaned,
            removed: data.stats.removed,
            cuts: data.stats.cuts,
            percent: data.stats.percent,
            capped: data.stats.capped,
          });
          // 3) Download the finished video.
          const blob = await (await fetch(`/api/process?jobId=${jobId}&download=1`)).blob();
          stopSteps();
          setStep(STEPS.length);
          setResultUrl(URL.createObjectURL(blob));
          setStatus("done");
          return;
        }
      }
      throw new Error("This is taking longer than expected. Please try again.");
    } catch (e) {
      stopSteps();
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const working = status === "working";

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
        {!file && <p className="mt-1 text-xs text-white/30">Up to ~{MAX_UPLOAD_MB} MB · record in 1080p for best speed</p>}
      </div>

      {/* Action */}
      <button
        onClick={generate}
        disabled={!file || working}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3.5 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {working ? "Editing…" : "Generate Clean Edit"}
      </button>

      {/* Professional processing screen */}
      {working && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="space-y-3">
            {STEPS.map((label, i) => {
              const state = i < step ? "done" : i === step ? "active" : "pending";
              return (
                <div key={label} className="flex items-center gap-3">
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                      state === "done"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : state === "active"
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "bg-white/5 text-white/30"
                    }`}
                  >
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
              Large file — exported at 720p so processing stays fast and reliable.
            </p>
          )}

          {resultUrl && (
            <>
              <video src={resultUrl} controls className="mx-auto mt-5 max-h-[70vh] w-full rounded-xl" style={{ maxHeight: "70vh", objectFit: "contain", background: "#000" }} />
              <a href={resultUrl} download="trimiq-edit.mp4" className="mt-4 block rounded-xl bg-white py-3 text-center font-medium text-ink transition hover:bg-white/90">
                Download clean video
              </a>
            </>
          )}
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
