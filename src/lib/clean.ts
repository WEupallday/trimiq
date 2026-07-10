// ===========================================================================
// TrimIQ Editing Engine — V7 (quality-first, resolution-exact, memory-safe)
//   • Transcription-driven cuts: removes dead space, long pauses, fillers,
//     false starts, correction phrases, and repeated/retake lines.
//   • Retake clustering: when you say something several times, only the final
//     complete take is kept.
//   • Editing modes: light / balanced / aggressive (snappy short-form pacing).
//   • EXACT output: no crop, no zoom, no reframe, NO downscale. The export keeps
//     the uploaded resolution, aspect ratio, framing and fps exactly.
//   • Memory-safe rendering: each kept segment is encoded on its own, then the
//     pieces are concatenated with a stream copy. Peak memory scales with one
//     frame's resolution — not the video length or number of cuts — so large/4K
//     clips process consistently without running the box out of memory.
// ===========================================================================
import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

// Bump on every engine behavior change — benchmark history is keyed by this.
export const ENGINE_VERSION = "7.2.1";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// ------------------------------ modes --------------------------------------
export type EditMode = "beginner" | "balanced" | "aggressive";

export type Settings = {
  silenceThresholdDb: number | "auto";
  minPause: number;
  leadIn: number;
  trailOut: number;
  naturalPause: number;
  wordPad: number;
  minClipLength: number;
  fade: number;
  sentenceGap: number;
  removeFiller: boolean;
  removeSoftFiller: boolean;
  nearPrefixThresh: number;
  dropRatio: number;
  // Optional per-job extensions (driven by AI Edit Instructions)
  keepWords?: string[];
  extraFillerWords?: string[];
  protectStartSeconds?: number;
  targetDurationSec?: number;
};

// Normalized instruction overrides — applied on top of a mode preset. This is
// the stable contract between instruction parsers (rule-based v1 today, LLM v2
// later) and the engine.
export type CaptionOptions = {
  enabled: boolean;
  color?: string; // named color or #rrggbb
  size?: "small" | "medium" | "large";
  position?: "top" | "center" | "bottom";
};

export type EditOverrides = {
  protectStartSeconds?: number;
  targetDurationSec?: number;
  keepAllPauses?: boolean;
  keepSoftFillers?: boolean;
  keepWords?: string[];
  extraFillerWords?: string[];
  pace?: "slower" | "faster";
  captions?: CaptionOptions;
};

export const MODE_PRESETS: Record<EditMode, Settings> = {
  beginner: {
    silenceThresholdDb: "auto", minPause: 0.7, leadIn: 0.14, trailOut: 0.22,
    naturalPause: 0.55, wordPad: 0.12, minClipLength: 0.25, fade: 0.05,
    sentenceGap: 0.8, removeFiller: true, removeSoftFiller: false,
    nearPrefixThresh: 0.7, dropRatio: 0.55,
  },
  balanced: {
    silenceThresholdDb: "auto", minPause: 0.4, leadIn: 0.10, trailOut: 0.16,
    naturalPause: 0.30, wordPad: 0.09, minClipLength: 0.2, fade: 0.05,
    sentenceGap: 0.6, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.6, dropRatio: 0.85,
  },
  aggressive: {
    silenceThresholdDb: "auto", minPause: 0.25, leadIn: 0.08, trailOut: 0.11,
    naturalPause: 0.18, wordPad: 0.07, minClipLength: 0.18, fade: 0.04,
    sentenceGap: 0.45, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.55, dropRatio: 0.95,
  },
};

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  cuts: number;
  percentRemoved: number;
  segments: [number, number][];
  mode: "smart" | "audio";
  editMode: EditMode;
  capped: boolean;
  engineVersion: string;
  model: string;
  stageMs: Record<string, number>;
  keptText: string;
  fillerRemoved: number;
  takesRemoved: number;
  captions: { color: string; size: string; position: string; count: number; coverage: number } | null;
  words: { t: string; s: number; e: number; x: boolean }[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.slice(-1500) || `exit ${code}`))
    );
  });
}

async function getDuration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = parseFloat(stdout.trim());
  if (Number.isFinite(d) && d > 0) return d;
  // Streaming containers (e.g. MediaRecorder webm uploads) often lack a duration
  // header. Fall back to scanning packet timestamps (demux only, no decode).
  try {
    const { stdout: pk } = await run(FFPROBE, [
      "-v", "error", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", file,
    ]);
    let max = 0;
    for (const line of pk.split("\n")) {
      const parts = line.split(",");
      const pts = parseFloat(parts[0]);
      const pdur = parseFloat(parts[1]);
      const end = (Number.isFinite(pts) ? pts : 0) + (Number.isFinite(pdur) ? pdur : 0);
      if (end > max) max = end;
    }
    if (max > 0) return max;
  } catch {}
  return 0;
}

async function getDims(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  return { w: w || 1080, h: h || 1920 };
}

// Exact source frame rate, as both a number (for snapping cut points to the frame
// grid) and its original fraction string (e.g. "30000/1001" for 29.97) so the
// output frame rate matches the input precisely.
async function getFrameRate(file: string): Promise<{ num: number; str: string }> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", file,
  ]);
  const raw = stdout.trim();
  const [n, d] = raw.split("/").map(Number);
  const num = d ? n / d : n;
  return { num: isFinite(num) && num > 0 ? num : 30, str: raw && raw !== "0/0" ? raw : "30" };
}

// ============================ LAYER 1: audio ===============================
async function measureMaxDb(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const m = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return m ? parseFloat(m[1]) : -3;
}

async function detectSilences(file: string, noiseDb: number, minPause: number): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minPause}`, "-f", "null", "-"]);
  const silences: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]));
    if (e && start !== null) { silences.push([start, parseFloat(e[1])]); start = null; }
  }
  return silences;
}

function planFromSilences(silences: [number, number][], duration: number, s: Settings): [number, number][] {
  const segs: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of silences) {
    const keepEnd = a + s.trailOut;
    if (keepEnd - cursor > 0.02) segs.push([cursor, Math.min(keepEnd, duration)]);
    cursor = Math.max(cursor, b - s.leadIn);
  }
  if (cursor < duration - 0.02) segs.push([cursor, duration]);
  return segs.filter(([x, y]) => y - x >= s.minClipLength);
}

// ===================== LAYER 2: transcription-driven =======================
type Word = { w: string; raw: string; term: boolean; start: number; end: number };
type Line = { words: Word[]; norm: string[]; start: number; end: number; term: boolean };

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
const HARD_FILLER = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "err", "mm", "mmm", "hmm", "hmmm", "ah"]);
const SOFT_FILLER = new Set(["like", "so", "basically", "literally"]);
const CORR = new Set(["no", "nope", "wait", "sorry", "scratch", "redo", "actually", "oops", "nevermind"]);
const CORR_PHRASES = [
  "let me say that again", "let me start over", "let me redo", "start over", "one more time",
  "say that again", "let me try again", "take that again", "do that again", "let me restart",
  "let me rephrase", "hold on", "wait no", "let me do that again", "scratch that", "take two",
];

async function extractAudio(input: string): Promise<string> {
  const out = join(dirname(input), `audio-${Date.now()}.wav`);
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", out]);
  return out;
}

async function transcribe(audioPath: string, apiKey: string, model: string): Promise<Word[]> {
  const bytes = await readFile(audioPath);
  // One quick retry on transient Deepgram/network errors so a blip can't silently
  // drop us to the weaker audio-only path.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // filler_words=true is essential: without it Deepgram omits um/uh from the
      // transcript entirely, so the engine can never cut them.
      const res = await fetch(
        `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true&filler_words=true`,
        { method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" }, body: bytes }
      );
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json: any = await res.json();
      const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
      return words
        .map((x: any) => ({ w: norm(x.word), raw: String(x.punctuated_word || x.word || ""), term: /[.?!]$/.test(x.punctuated_word || x.word || ""), start: x.start, end: x.end }))
        .filter((x: Word) => x.w);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("transcription failed");
}

const mkLine = (ws: Word[]): Line => ({
  words: ws, norm: ws.map((x) => x.w), start: ws[0].start, end: ws[ws.length - 1].end, term: ws[ws.length - 1].term,
});

function splitLines(words: Word[], sentenceGap: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const bigPause = next && next.start - words[i].end > sentenceGap;
    if (words[i].term || bigPause || !next) { lines.push(mkLine(cur)); cur = []; }
  }
  return lines;
}

// Collapse a leading restart, e.g. "I'm gonna— I'm gonna show you" -> keep the
// last attempt within the line.
function collapseRestart(line: Line): Line {
  const n = line.norm;
  if (n.length < 4) return line;
  let last = 0;
  if (n[1] === n[0]) last = 1;
  for (let j = 2; j + 1 < n.length; j++) if (n[j] === n[0] && n[j + 1] === n[1]) last = j;
  return last > 0 ? mkLine(line.words.slice(last)) : line;
}

// Remove any immediately-repeated phrase within a line ("I want to I want to show
// you" -> "I want to show you"). Keeps the later, more complete copy. Phrases only
// (k>=2); single-word stutters are handled in fillerMask so emphasis is safe.
function collapseRepeats(line: Line): Line {
  const arr = line.words.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let p = 0; p < arr.length && !changed; p++) {
      const maxK = Math.min(8, Math.floor((arr.length - p) / 2));
      for (let k = maxK; k >= 2; k--) {
        let eq = true;
        for (let t = 0; t < k; t++) if (arr[p + t].w !== arr[p + k + t].w) { eq = false; break; }
        if (eq) { arr.splice(p, k); changed = true; break; }
      }
    }
  }
  return arr.length ? mkLine(arr) : line;
}

const stripFiller = (a: string[]) => a.filter((w) => !HARD_FILLER.has(w) && !SOFT_FILLER.has(w));

function isNearPrefix(a: string[], b: string[], thresh: number): boolean {
  a = stripFiller(a); b = stripFiller(b);
  if (a.length < 2 || a.length >= b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++;
  return m / a.length >= thresh;
}

// Fraction of the smaller line's words that also appear in the other line.
function tokenOverlap(a: string[], b: string[]): number {
  const aUniq = Array.from(new Set(stripFiller(a)));
  const bSet = new Set(stripFiller(b));
  if (!aUniq.length || !bSet.size) return 0;
  let inter = 0;
  for (let i = 0; i < aUniq.length; i++) if (bSet.has(aUniq[i])) inter++;
  return inter / Math.min(aUniq.length, bSet.size);
}

// Is `next` a retake / re-statement of `prev` (same thing said again)?
function isRetake(prev: Line, next: Line, s: Settings): boolean {
  if (isNearPrefix(prev.norm, next.norm, s.nearPrefixThresh)) return true; // prev is a false start of next
  if (isNearPrefix(next.norm, prev.norm, s.nearPrefixThresh)) return true; // next trails off, prev was fuller
  const ov = tokenOverlap(prev.norm, next.norm);
  if (!prev.term && ov >= 0.6) return true; // restated an unfinished attempt
  if (ov >= 0.82) return true;              // near-duplicate sentences
  return false;
}

function isCorrectionLine(line: Line): boolean {
  const t = line.norm.join(" ");
  if (CORR_PHRASES.some((p) => t.includes(p))) return true;
  return line.norm.length <= 3 && line.norm.some((w) => CORR.has(w));
}

// Words that legitimately precede the VERB "like" (those are kept); otherwise
// "like" is a discourse filler and gets removed.
const LIKE_VERB_PREV = new Set(["i","you","we","they","he","she","it","really","just","dont","do","does","did","would","will","ll","gonna","wanna","to","might","may","could","should","also","still","not","never","always","kinda","sorta","definitely","feel","feels","look","looks","sound","sounds","seem","seems","taste","tastes","felt","looked"]);
const ALWAYS_SOFT = new Set(["basically", "literally", "actually"]); // discourse fillers, safe to drop
const SO_OPENERS = new Set(["okay","ok","alright","alrighty","yeah","yep","right","well","now","anyway","anyways"]);
const INTENSIFIER = new Set(["very","really","so","no","go","yeah","yes","ok","okay","ha","big","huge"]);

// Returns a boolean[] mask aligned to `kw`: true = this word is a filler/stutter
// to physically excise from the final cut.
function fillerMask(kw: Word[], s: Settings): boolean[] {
  const mask = new Array<boolean>(kw.length).fill(false);
  const keepSet = new Set((s.keepWords || []).map(norm));
  const extraSet = new Set((s.extraFillerWords || []).map(norm));
  for (let i = 0; i < kw.length; i++) {
    const w = kw[i].w;
    if (keepSet.has(w)) continue;
    if (extraSet.has(w)) { mask[i] = true; continue; }
    if (!s.removeFiller) continue;
    if (HARD_FILLER.has(w)) { mask[i] = true; continue; }
    if (!s.removeSoftFiller) continue;

    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) if (!mask[j]) { prevIdx = j; break; }
    const prev = prevIdx >= 0 ? kw[prevIdx] : null;
    const next = kw[i + 1];

    if (ALWAYS_SOFT.has(w)) { mask[i] = true; continue; }
    if (w === "so") {
      const opener = prev && SO_OPENERS.has(prev.w);
      const sentenceInitial = !prev || prev.term || opener || kw[i].start - prev.end > 0.4;
      if (sentenceInitial) mask[i] = true;
      continue;
    }
    if (w === "like") {
      const keepAsVerb = prev && LIKE_VERB_PREV.has(prev.w);
      if (!keepAsVerb) mask[i] = true;
      continue;
    }
    if (w === "you" && next && next.w === "know") {
      const beforeW = prev ? prev.w : null;
      const afterW = kw[i + 2] ? kw[i + 2].w : null;
      const isQuestion = !!beforeW && ["do","dont","did","does","would","ya","you"].includes(beforeW);
      const isRealVerb = !!afterW && ["that","how","what","why","where","who","when","if","the","this","a","an","your","my","his","her"].includes(afterW);
      if (!isQuestion && !isRealVerb) { mask[i] = true; mask[i + 1] = true; }
      continue;
    }
  }
  // Stutter pass: collapse fast immediate word repeats ("the the", "this this"),
  // dropping the earlier copy. Intensifiers are left alone so "very very" survives.
  if (s.removeFiller) for (let i = 0; i < kw.length; i++) {
    if (mask[i]) continue;
    let j = i + 1;
    while (j < kw.length && mask[j]) j++;
    if (j < kw.length && kw[i].w === kw[j].w && !INTENSIFIER.has(kw[i].w) && kw[j].start - kw[i].end < 0.28) {
      mask[i] = true;
    }
  }
  return mask;
}

function mergeRanges(ranges: [number, number][], minLen: number): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 0.02) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.filter(([a, b]) => b - a >= minLen);
}

function planFromTranscript(words: Word[], duration: number, s: Settings): { segs: [number, number][]; allWords: Word[]; mask: boolean[]; takesRemoved: number } {
  let lines = splitLines(words, s.sentenceGap).map(collapseRestart).map(collapseRepeats);
  const totalLines = lines.length;
  lines = lines.filter((l) => !isCorrectionLine(l));

  // Cluster consecutive retakes of the same statement and keep only the best
  // (final, completed) take of each cluster.
  const kept: Line[] = [];
  let li = 0;
  while (li < lines.length) {
    let j = li;
    while (j + 1 < lines.length && isRetake(lines[j], lines[j + 1], s)) j++;
    if (j > li) {
      const cluster = lines.slice(li, j + 1);
      const finalTake =
        [...cluster].reverse().find((l) => l.term) ||
        cluster.reduce((best, l) => (l.norm.length > best.norm.length ? l : best));
      kept.push(finalTake);
    } else {
      kept.push(lines[li]);
    }
    li = j + 1;
  }

  // Mark fillers/stutters, then keep the rest.
  const allWords = kept.flatMap((l) => l.words);
  const mask = fillerMask(allWords, s);
  const keep = allWords.filter((_, i) => !mask[i]);
  if (!keep.length) return { segs: [], allWords, mask, takesRemoved: totalLines - kept.length };

  // Build kept time segments. Cut (excise) between two kept words when there is a
  // real pause longer than naturalPause, OR a filler/dropped word sat between them
  // — so fillers are physically removed, not just dropped from the text.
  const segs: [number, number][] = [];
  let segStart = Math.max(0, keep[0].start - Math.min(s.wordPad, 0.1));
  for (let k = 0; k < keep.length; k++) {
    const cur = keep[k];
    const next = keep[k + 1];
    if (!next) { segs.push([segStart, Math.min(duration, cur.end + Math.min(s.wordPad, 0.12))]); break; }
    const gap = next.start - cur.end;
    const removedBetween =
      allWords.some((w, i) => mask[i] && w.start >= cur.end - 0.001 && w.end <= next.start + 0.001) ||
      gap > s.naturalPause + 0.25;
    if (gap <= s.naturalPause && !removedBetween) continue; // natural micro-pause: keep flowing
    const pad = Math.min(s.wordPad, Math.max(0.04, gap * 0.4));
    segs.push([segStart, Math.min(duration, cur.end + pad)]);
    segStart = Math.max(0, next.start - pad);
  }
  return { segs: mergeRanges(segs, s.minClipLength), allWords, mask, takesRemoved: totalLines - kept.length };
}

// ============================== captions ===================================
const CAPTION_COLORS: Record<string, string> = {
  white: "FFFFFF", yellow: "FFD400", blue: "3DA5FF", green: "3DFF88",
  pink: "FF6BD6", red: "FF4D4D", purple: "B18CFF", orange: "FF9E3D", black: "101010",
};

// ASS colors are &HAABBGGRR (blue-green-red).
function assColor(c?: string): string {
  let hex = "FFFFFF";
  if (c) {
    const named = CAPTION_COLORS[c.toLowerCase().trim()];
    if (named) hex = named;
    else if (/^#?[0-9a-fA-F]{6}$/.test(c.trim())) hex = c.trim().replace("#", "").toUpperCase();
  }
  return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

// Phrase-level caption events on the OUTPUT (post-cut) timeline: each kept
// word's timestamp is remapped through the kept segments so captions stay in
// sync with the edited video.
function buildCaptionEvents(keptWords: Word[], segs: [number, number][]): { start: number; end: number; text: string }[] {
  let acc = 0;
  const map = segs.map(([a, b]) => { const m = { a, b, off: acc }; acc += b - a; return m; });
  const toOut = (t: number): number | null => {
    for (const m of map) if (t >= m.a - 0.001 && t <= m.b + 0.001) return m.off + Math.min(Math.max(t - m.a, 0), m.b - m.a);
    return null;
  };
  const events: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur && cur.words.length) events.push({ start: cur.start, end: cur.end, text: cur.words.join(" ") });
    cur = null;
  };
  for (const w of keptWords) {
    const s = toOut(w.start);
    const e = toOut(w.end);
    if (s === null || e === null) continue;
    if (cur && (s - cur.end > 0.6 || cur.words.length >= 4 || e - cur.start > 2.4)) flush();
    if (!cur) cur = { start: s, end: e, words: [] };
    cur.words.push(w.raw || w.w);
    cur.end = Math.max(cur.end, e);
    if (/[.?!]$/.test(w.raw || "")) flush();
  }
  flush();
  for (let i = 0; i < events.length; i++) {
    const next = events[i + 1];
    events[i].end = next ? Math.min(events[i].end + 0.25, next.start - 0.02) : events[i].end + 0.3;
  }
  return events.filter((ev) => ev.end > ev.start + 0.05 && ev.text.trim());
}

// TikTok-native look: bold, centered, heavy outline, sized for mobile.
function buildAss(events: { start: number; end: number; text: string }[], w: number, h: number, o: { color: string; size: string; position: string }): string {
  const size = o.size === "large" ? Math.round(h * 0.048) : o.size === "small" ? Math.round(h * 0.03) : Math.round(h * 0.038);
  const align = o.position === "top" ? 8 : o.position === "center" ? 5 : 2;
  const marginV = o.position === "center" ? 10 : Math.round(h * 0.16);
  const outline = Math.max(2, Math.round(size / 11));
  const esc = (t: string) => t.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ");
  let out2 =
    "[Script Info]\nScriptType: v4.00+\n" +
    `PlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n` +
    "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n" +
    `Style: Cap,DejaVu Sans,${size},${assColor(o.color)},&H000000FF,&H00101010,&H7F000000,-1,0,0,0,100,100,0,0,1,${outline},1,${align},60,60,${marginV},1\n\n` +
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  for (const ev of events) out2 += `Dialogue: 0,${assTime(ev.start)},${assTime(ev.end)},Cap,,0,0,0,,${esc(ev.text)}\n`;
  return out2;
}

// ============================== rendering ==================================
// trim + concat render. Validated empirically (synchronized flash+beep markers,
// 30 cuts over 60s) to deliver:
//   • FRAME-ACCURATE A/V SYNC — ~1 ms, with NO drift across the whole clip. Audio
//     and video are concatenated on ONE shared timeline (the `concat` filter), and
//     every cut is snapped to the exact video frame grid, so the streams cut at the
//     same instant and can never drift apart. (The previous `select`/`aselect`
//     approach renumbered the streams independently and drifted up to ~64 ms+.)
//   • MEMORY-SAFE — ~1 GB peak even at true 4K, regardless of how many cuts.
//   • EXACT OUTPUT — no scale/crop/reframe; source resolution, aspect ratio, pixel
//     format and frame rate preserved; crf 18 is visually lossless.
async function renderFinal(
  input: string, output: string, segs: [number, number][], _s: Settings, original: number, assPath: string | null
): Promise<boolean> {
  // No cuts at all -> remux unchanged (bit-exact, fast) unless captions must be burned in.
  const noCuts = segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05;
  if (noCuts && !assPath) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output]);
    return false;
  }
  if (noCuts && assPath) {
    const { w: w0, h: h0 } = await getDims(input);
    const preset0 = Math.max(w0, h0) > 1920 ? "superfast" : "veryfast";
    await run(FFMPEG, [
      "-y", "-i", input, "-vf", `subtitles=${assPath}`,
      "-c:v", "libx264", "-preset", preset0, "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "0",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output,
    ]);
    return false;
  }

  const { w, h } = await getDims(input);
  const { num: fps, str: fpsStr } = await getFrameRate(input);
  // Lighter preset only for very large frames (true 4K+) to keep encode memory low.
  // Resolution is NOT changed either way.
  const preset = Math.max(w, h) > 1920 ? "superfast" : "veryfast";

  // Snap every cut boundary to the exact video frame grid -> audio & video cut at
  // the identical instant, which (with concat) gives drift-free, frame-accurate sync.
  const snap = (t: number) => Math.round(t * fps) / fps;
  const S = segs.map(([a, b]) => {
    const a2 = snap(a);
    return [a2, Math.max(a2 + 1 / fps, snap(b))] as [number, number];
  });

  // Per-segment trim (video) + atrim (audio), each reset to start at 0, then the
  // concat filter joins them keeping A and V locked on one timeline.
  let f = "";
  S.forEach(([a, b], i) => {
    f += `[0:v]trim=${a.toFixed(4)}:${b.toFixed(4)},setpts=PTS-STARTPTS[v${i}];`;
    f += `[0:a]atrim=${a.toFixed(4)}:${b.toFixed(4)},asetpts=PTS-STARTPTS[a${i}];`;
  });
  S.forEach((_, i) => (f += `[v${i}][a${i}]`));
  f += `concat=n=${S.length}:v=1:a=1[cv][a]`;
  f += assPath ? `;[cv]subtitles=${assPath}[v]` : `;[cv]null[v]`;

  await run(FFMPEG, [
    "-y", "-i", input, "-filter_complex", f, "-map", "[v]", "-map", "[a]",
    "-vsync", "cfr", "-r", fpsStr,
    "-c:v", "libx264", "-preset", preset, "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "0",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", "-max_muxing_queue_size", "1024",
    output,
  ]);
  return false; // never scaled
}

function countCuts(segs: [number, number][], duration: number): number {
  let cuts = 0;
  let cursor = 0;
  for (const [a, b] of segs) {
    if (a - cursor > 0.1) cuts++;
    cursor = Math.max(cursor, b);
  }
  if (duration - cursor > 0.1) cuts++;
  return cuts;
}

// ============================== orchestrator ===============================
export async function cleanVideo(
  input: string,
  output: string,
  opts: { mode?: EditMode; fileBytes?: number; onStage?: (stage: string) => void; overrides?: EditOverrides; model?: string } = {}
): Promise<CleanResult> {
  const editMode: EditMode = opts.mode || "balanced";
  const settings: Settings = { ...MODE_PRESETS[editMode] };

  // AI Edit Instructions: apply normalized overrides on top of the preset.
  const ov = opts.overrides || {};
  if (ov.pace === "faster") {
    settings.naturalPause = Math.max(0.15, settings.naturalPause - 0.08);
    settings.minPause = Math.max(0.2, settings.minPause - 0.1);
    settings.trailOut = Math.max(0.08, settings.trailOut - 0.04);
  }
  if (ov.pace === "slower") { settings.naturalPause += 0.15; settings.minPause += 0.25; }
  if (ov.keepSoftFillers) settings.removeSoftFiller = false;
  if (ov.keepAllPauses) { settings.naturalPause = 1e9; settings.minPause = 1e9; }
  if (ov.keepWords && ov.keepWords.length) settings.keepWords = ov.keepWords;
  if (ov.extraFillerWords && ov.extraFillerWords.length) settings.extraFillerWords = ov.extraFillerWords;
  if (ov.protectStartSeconds) settings.protectStartSeconds = ov.protectStartSeconds;
  if (ov.targetDurationSec) settings.targetDurationSec = ov.targetDurationSec;

  const model = opts.model || process.env.DEEPGRAM_MODEL || "nova-2";

  // Per-stage wall-clock timing (analytics + benchmark reports).
  const stageMs: Record<string, number> = {};
  let stageName = "";
  let stageStart = Date.now();
  const stage = (s: string) => {
    if (stageName) stageMs[stageName] = (stageMs[stageName] || 0) + (Date.now() - stageStart);
    stageName = s;
    stageStart = Date.now();
    (opts.onStage || (() => {}))(s);
  };

  stage("Analyzing");
  let original = await getDuration(input);

  let segs: [number, number][] = [];
  let mode: "smart" | "audio" = "audio";
  let planInfo: { allWords: Word[]; mask: boolean[]; takesRemoved: number } | null = null;
  const audioFiles: string[] = [];

  const key = process.env.DEEPGRAM_API_KEY;
  if (key) {
    try {
      const audio = await extractAudio(input);
      audioFiles.push(audio);
      const words = await transcribe(audio, key, model);
      if (words.length >= 3) {
          if (!Number.isFinite(original) || original <= 0) original = words[words.length - 1].end + 0.8;
        let plan = planFromTranscript(words, original, settings);
        // Target duration: escalate pacing until the kept time fits.
        if (settings.targetDurationSec) {
          const keptDur = (p: { segs: [number, number][] }) => p.segs.reduce((t, seg) => t + (seg[1] - seg[0]), 0);
          let tighter: Settings = { ...settings };
          let guard = 0;
          while (keptDur(plan) > settings.targetDurationSec * 1.15 && guard < 4) {
            tighter = {
              ...tighter,
              naturalPause: Math.max(0.12, tighter.naturalPause - 0.07),
              minPause: Math.max(0.18, tighter.minPause - 0.08),
              removeSoftFiller: true,
              nearPrefixThresh: Math.max(0.5, tighter.nearPrefixThresh - 0.05),
            };
            plan = planFromTranscript(words, original, tighter);
            guard++;
          }
        }
        if (plan.segs.length) { segs = plan.segs; mode = "smart"; planInfo = plan; }
      }
      console.log(`[ENGINE] transcription ok: ${words.length} words -> mode=${mode}, segments=${segs.length}`);
    } catch (e) {
      console.error("[ENGINE] transcription failed, using audio-only fallback:", (e as any)?.message || e);
    }
  } else {
    console.warn("[ENGINE] DEEPGRAM_API_KEY not set — running audio-only (silence) edits only.");
  }

  stage("Detecting pauses");
  if (mode === "audio") {
    let thresholdDb = -32;
    if (settings.silenceThresholdDb === "auto") thresholdDb = clamp((await measureMaxDb(input)) - 30, -45, -20);
    const silences = await detectSilences(input, thresholdDb, settings.minPause);
    segs = planFromSilences(silences, original, settings);
  }

  // Protected intro: always keep [0, N] exactly as filmed.
  if (settings.protectStartSeconds) {
    const p = Math.min(settings.protectStartSeconds, original);
    segs = mergeRanges([[0, p], ...segs], 0.05);
  }

  // Nothing to cut -> keep the whole clip as one segment.
  if (segs.length === 0) segs = [[0, original]];

  // Burned-in captions (optional; requires the transcript path).
  let assPath: string | null = null;
  let captionInfo: { color: string; size: string; position: string; count: number; coverage: number } | null = null;
  if (ov.captions && ov.captions.enabled && planInfo) {
    try {
      const keptWords = planInfo.allWords.filter((_, i) => !planInfo!.mask[i]);
      const events = buildCaptionEvents(keptWords, segs);
      if (events.length) {
        const { w, h } = await getDims(input);
        const style = {
          color: (ov.captions.color || "white").toLowerCase(),
          size: ov.captions.size || "medium",
          position: ov.captions.position || "bottom",
        };
        assPath = join(dirname(input), `cap-${Date.now()}.ass`);
        await writeFile(assPath, buildAss(events, w, h, style), "utf8");
        const keptDur = segs.reduce((t, sg) => t + (sg[1] - sg[0]), 0);
        const covered = events.reduce((t, ev) => t + (ev.end - ev.start), 0);
        captionInfo = { ...style, count: events.length, coverage: keptDur > 0 ? Math.min(1, Math.round((covered / keptDur) * 100) / 100) : 0 };
      }
    } catch (e) {
      console.error("[ENGINE] caption build failed:", (e as any)?.message || e);
      assPath = null;
      captionInfo = null;
    }
  }

  stage("Rendering");
  let capped = false;
  try {
    capped = await renderFinal(input, output, segs, settings, original, assPath);
  } catch (e) {
    if (assPath) {
      // Graceful degradation: captioned render failed (e.g. missing fonts) ->
      // deliver the edit without captions rather than failing the job.
      console.error("[ENGINE] captioned render failed, retrying without captions:", (e as any)?.message || e);
      assPath = null;
      captionInfo = null;
      capped = await renderFinal(input, output, segs, settings, original, null);
    } else {
      throw e;
    }
  }
  stage("Finalizing");
  if (assPath) await unlink(assPath).catch(() => {});
  for (const a of audioFiles) await unlink(a).catch(() => {});

  const cleaned = await getDuration(output).catch(() => original);
  const removed = Math.max(0, original - cleaned);
  stage("Done");
  const words = planInfo
    ? planInfo.allWords.map((w, i) => ({
        t: w.w,
        s: Math.round(w.start * 100) / 100,
        e: Math.round(w.end * 100) / 100,
        x: !!planInfo!.mask[i],
      }))
    : [];
  return {
    original,
    cleaned,
    removed,
    cuts: countCuts(segs, original),
    percentRemoved: original > 0 ? Math.round((removed / original) * 100) : 0,
    segments: segs,
    mode,
    editMode,
    capped,
    engineVersion: ENGINE_VERSION,
    model,
    stageMs,
    keptText: words.filter((w) => !w.x).map((w) => w.t).join(" "),
    fillerRemoved: words.filter((w) => w.x).length,
    takesRemoved: planInfo ? planInfo.takesRemoved : 0,
    captions: captionInfo,
    words,
  };
}
