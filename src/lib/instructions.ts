// ===========================================================================
// AI Edit Instructions — v1 rule-based parser.
//
// Contract: free text in -> normalized EditOverrides out (defined in clean.ts).
// An LLM-powered v2 can replace parseInstructions() with the exact same
// signature and output schema without touching the engine or the UI.
// ===========================================================================
import type { EditOverrides } from "./clean";

export type ParsedInstructions = {
  overrides: EditOverrides;
  applied: string[];      // human-readable summary of what was understood
  unrecognized: string[]; // fragments we couldn't map (surfaced to the user)
};

const num = (m: RegExpMatchArray | null, i = 1) => (m ? parseFloat(m[i]) : NaN);

export function parseInstructions(text: string): ParsedInstructions {
  const overrides: EditOverrides = {};
  const applied: string[] = [];
  const unrecognized: string[] = [];
  const parts = String(text || "")
    .toLowerCase()
    .split(/[.;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const p of parts) {
    let hit = false;

    // Protect the intro: "don't cut the intro", "keep the first 5 seconds"
    let m = p.match(/first\s+(\d+(?:\.\d+)?)\s*(?:s\b|sec|seconds)/);
    if (m || /(don'?t|do not|never|keep|leave|protect)[^.]*\b(intro|beginning|start|hook)\b/.test(p)) {
      const secs = Math.min(30, num(m) || 5);
      overrides.protectStartSeconds = secs;
      applied.push(`Keep the first ${secs}s untouched`);
      hit = true;
    }

    // Target duration: "target 30 seconds", "make it about 45s", "under a minute"
    m = p.match(/(?:target|about|around|under|max|to)\s*~?\s*(\d+)\s*(?:s\b|sec|seconds)/);
    if (m && /target|about|around|under|max|make|shorten|length|long/.test(p)) {
      overrides.targetDurationSec = Math.max(5, num(m));
      applied.push(`Aim for ~${overrides.targetDurationSec}s total`);
      hit = true;
    } else if (/\bminute\b/.test(p) && /under|max|about|around|target/.test(p)) {
      overrides.targetDurationSec = 60;
      applied.push("Aim for ~60s total");
      hit = true;
    }

    // Pauses: "keep my pauses", "don't remove silences"
    if (/(keep|leave|don'?t (?:cut|remove|touch))[^.]*\b(pause|pauses|silence|silences|breath)/.test(p)) {
      overrides.keepAllPauses = true;
      applied.push("Keep natural pauses");
      hit = true;
    }

    // Soft fillers: "leave 'like' alone", "keep my filler words"
    if (/(keep|leave|don'?t (?:cut|remove))[^.]*\b(like|so|basically|literally|filler)/.test(p) && !/first/.test(p)) {
      overrides.keepSoftFillers = true;
      applied.push("Leave casual words (like / so / basically) alone");
      hit = true;
    }

    // Pace
    if (/cut (?:harder|more)|faster|snappier|tighter|more aggressive/.test(p)) {
      overrides.pace = "faster";
      applied.push("Cut harder — faster pacing");
      hit = true;
    } else if (/cut less|gentler|softer|less aggressive|slower/.test(p)) {
      overrides.pace = "slower";
      applied.push("Cut more gently");
      hit = true;
    }

    // Named words: keep "X" / also remove "X"
    m = p.match(/(?:keep|never cut|don'?t (?:cut|remove))[^"'“]*["“']([^"”']{1,40})["”']/);
    if (m) {
      overrides.keepWords = [...(overrides.keepWords || []), m[1]];
      applied.push(`Never cut "${m[1]}"`);
      hit = true;
    }
    m = p.match(/(?:also\s+)?(?:remove|cut)[^"'“]*["“']([^"”']{1,40})["”']/);
    if (m && !(overrides.keepWords || []).includes(m[1])) {
      overrides.extraFillerWords = [...(overrides.extraFillerWords || []), m[1]];
      applied.push(`Also remove "${m[1]}"`);
      hit = true;
    }

    // Captions: "add captions", "make the captions blue", "big captions at the top"
    if (/captions?|subtitles?/.test(p)) {
      const cap = overrides.captions || { enabled: true };
      cap.enabled = !/\b(no|without|remove|disable)\b/.test(p);
      const colorM = p.match(/\b(white|yellow|blue|green|pink|red|purple|orange|black)\b/);
      if (colorM) cap.color = colorM[1];
      if (/\b(big|large|huge)\b/.test(p)) cap.size = "large";
      else if (/\b(small|tiny|subtle)\b/.test(p)) cap.size = "small";
      if (/\btop\b/.test(p)) cap.position = "top";
      else if (/\b(middle|center|centre)\b/.test(p)) cap.position = "center";
      else if (/\bbottom\b/.test(p)) cap.position = "bottom";
      overrides.captions = cap;
      applied.push(
        cap.enabled
          ? `Captions on${cap.color ? ` (${cap.color})` : ""}${cap.size ? `, ${cap.size}` : ""}${cap.position ? `, ${cap.position}` : ""}`
          : "Captions off"
      );
      hit = true;
    }

    if (!hit) unrecognized.push(p);
  }

  return { overrides, applied, unrecognized };
}
