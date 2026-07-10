"use client";

import { useEffect, useRef, useState } from "react";

type RunResult = { mode: string; model: string; engineVersion: string; overall: number; report: string };
type ClipResult = { clipName: string; results: RunResult[] };
type HistoryRow = {
  engineVersion: string; model: string; lastRun: string; runs: number;
  overall: number; avgProcessingSec: number; fillerRemovalPct: number; captionScore: number;
};

const ALL_MODES = ["beginner", "balanced", "aggressive"];
const ALL_MODELS = ["nova-2", "nova-3"];

export default function BenchRunner() {
  const [files, setFiles] = useState<File[]>([]);
  const [label, setLabel] = useState("baseline");
  const [modes, setModes] = useState<string[]>(["balanced"]);
  const [models, setModels] = useState<string[]>(["nova-2"]);
  const [withCaptions, setWithCaptions] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<ClipResult[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadHistory() {
    try {
      const r = await fetch("/api/bench?history=1");
      const d = await r.json();
      if (Array.isArray(d.history)) setHistory(d.history);
    } catch {}
  }
  useEffect(() => { loadHistory(); }, []);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function run() {
    if (!files.length || running || !modes.length || !models.length) return;
    setRunning(true);
    setError("");
    setResults([]);
    setLog([]);
    for (const f of files) {
      setLog((l) => [...l, `Running ${f.name} (${modes.length * models.length} combos)…`]);
      try {
        const res = await fetch(
          `/api/bench?name=${encodeURIComponent(f.name)}&label=${encodeURIComponent(label)}&modes=${modes.join(",")}&models=${models.join(",")}${withCaptions ? "&captions=1" : ""}`,
          { method: "POST", headers: { "Content-Type": f.type || "video/mp4" }, body: f }
        );
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Run failed.");
        setResults((r) => [...r, { clipName: f.name, results: d.results }]);
        setLog((l) => [...l, `✓ ${f.name} done`]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Run failed.";
        setError(`${f.name}: ${msg}`);
        setLog((l) => [...l, `✗ ${f.name} failed`]);
      }
    }
    setRunning(false);
    loadHistory();
  }

  const box = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

  return (
    <div className="space-y-6">
      {/* controls */}
      <div className={box}>
        <div
          onClick={() => !running && inputRef.current?.click()}
          className="cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50 transition hover:border-indigo-400/40"
        >
          <input ref={inputRef} type="file" accept="video/*" multiple className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          {files.length ? `${files.length} clip${files.length === 1 ? "" : "s"} selected — ${files.map((f) => f.name).join(", ").slice(0, 120)}` : "Click to choose the baseline clip set (same clips every run)"}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-white/40">Modes</span>
            {ALL_MODES.map((m) => (
              <button key={m} onClick={() => toggle(modes, setModes, m)} disabled={running}
                className={`rounded-lg border px-2.5 py-1 text-xs capitalize transition ${modes.includes(m) ? "border-indigo-400/50 bg-indigo-500/15 text-white" : "border-white/10 text-white/50 hover:text-white"}`}>
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-white/40">Models</span>
            {ALL_MODELS.map((m) => (
              <button key={m} onClick={() => toggle(models, setModels, m)} disabled={running}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${models.includes(m) ? "border-fuchsia-400/50 bg-fuchsia-500/15 text-white" : "border-white/10 text-white/50 hover:text-white"}`}>
                {m}
              </button>
            ))}
          </div>
          <button onClick={() => setWithCaptions((v) => !v)} disabled={running}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${withCaptions ? "border-emerald-400/50 bg-emerald-500/15 text-white" : "border-white/10 text-white/50 hover:text-white"}`}>
            {withCaptions ? "\u2713 " : ""}captions
          </button>
          <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={running} maxLength={100}
            placeholder="Run label"
            className="w-36 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-indigo-400/50 focus:outline-none" />
          <button onClick={run} disabled={running || !files.length}
            className="ml-auto rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/45 disabled:opacity-40">
            {running ? "Running…" : "Run benchmark"}
          </button>
        </div>
        {log.length > 0 && (
          <div className="mt-3 space-y-0.5 text-xs text-white/45">{log.map((l, i) => <p key={i}>{l}</p>)}</div>
        )}
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>

      {/* per-video reports */}
      {results.map((c, i) => (
        <div key={i} className={box}>
          <p className="mb-3 text-sm font-semibold text-white">Video {i + 1} — {c.clipName}</p>
          <div className="space-y-2">
            {c.results.map((r, j) => (
              <div key={j} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 capitalize text-indigo-200">{r.mode}</span>
                  <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-fuchsia-200">{r.model}</span>
                  <span className="text-white/35">engine v{r.engineVersion}</span>
                  <span className={`ml-auto font-bold ${r.overall >= 90 ? "text-emerald-300" : r.overall >= 75 ? "text-amber-300" : "text-red-300"}`}>
                    {r.overall}/100
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-white/65">{r.report}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* version history */}
      <div className={box}>
        <p className="mb-3 text-sm font-semibold text-white">Version history</p>
        {history.length === 0 ? (
          <p className="text-xs text-white/40">No benchmark runs yet — run the baseline set to create v-history.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-white/35">
                  <th className="py-2 pr-4">Engine</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Runs</th>
                  <th className="py-2 pr-4">Overall</th>
                  <th className="py-2 pr-4">Avg time</th>
                  <th className="py-2 pr-4">Filler removal</th>
                  <th className="py-2 pr-4">Captions</th>
                  <th className="py-2">Last run</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-white/5 text-white/70">
                    <td className="py-2 pr-4 font-medium text-white">v{h.engineVersion}</td>
                    <td className="py-2 pr-4">{h.model}</td>
                    <td className="py-2 pr-4">{h.runs}</td>
                    <td className={`py-2 pr-4 font-bold ${h.overall >= 90 ? "text-emerald-300" : h.overall >= 75 ? "text-amber-300" : "text-red-300"}`}>{h.overall}</td>
                    <td className="py-2 pr-4">{h.avgProcessingSec}s</td>
                    <td className="py-2 pr-4">{h.fillerRemovalPct}%</td>
                    <td className="py-2 pr-4">{h.captionScore}</td>
                    <td className="py-2 text-white/40">{new Date(h.lastRun).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
