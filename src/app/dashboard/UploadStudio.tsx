"use client";

import { useRef, useState } from "react";

type Stats = { original: number; cleaned: number; removed: number };

export default function UploadStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setError("");
    setResultUrl("");
    setStats(null);
  }

  async function generate() {
    if (!file) return;
    setStatus("working");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/process", { method: "POST", body });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Processing failed." }));
        throw new Error(j.error || "Processing failed.");
      }
      const removed = Number(res.headers.get("X-Removed-Seconds") || 0);
      const original = Number(res.headers.get("X-Original-Seconds") || 0);
      const cleaned = Number(res.headers.get("X-Cleaned-Seconds") || 0);
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      setStats({ original, cleaned, removed });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const working = status === "working";

  return (
    <div className="mx-auto max-w-2xl">
      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className="glass cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center transition hover:border-indigo-400/40"
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </div>
        {file ? (
          <p className="mt-4 font-medium">{file.name}</p>
        ) : (
          <p className="mt-4 text-white/60">Click to choose a video, or drag one here</p>
        )}
        {file && (
          <p className="mt-1 text-sm text-white/40">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
        )}
      </div>

      {/* Action */}
      <button
        onClick={generate}
        disabled={!file || working}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3.5 font-medium shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {working ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Cleaning your video…
          </>
        ) : (
          "Generate Clean Edit"
        )}
      </button>

      {working && (
        <p className="mt-3 text-center text-sm text-white/50">
          This can take a moment depending on the video length. Keep this tab open.
        </p>
      )}

      {status === "error" && (
        <div className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Result */}
      {status === "done" && stats && (
        <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-6">
          <p className="font-medium text-emerald-300">Your clean edit is ready.</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Stat label="Original" value={`${stats.original.toFixed(1)}s`} />
            <Stat label="Cleaned" value={`${stats.cleaned.toFixed(1)}s`} />
            <Stat label="Removed" value={`${stats.removed.toFixed(1)}s`} highlight />
          </div>
          {resultUrl && (
            <>
              <video src={resultUrl} controls className="mt-5 w-full rounded-xl" />
              <a
                href={resultUrl}
                download="trimiq-clean.mp4"
                className="mt-4 block rounded-xl bg-white py-3 text-center font-medium text-ink transition hover:bg-white/90"
              >
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
    <div className="glass rounded-xl p-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${highlight ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}
