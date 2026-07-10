// ===========================================================================
// AI Edit Instructions - v1.1 rule-based parser.
//
// Contract: free text in -> normalized EditOverrides out (defined in clean.ts).
// An LLM-powered v2 can replace parseInstructions() with the exact same
// signature and output schema without touching the engine or the UI.
//
// Design rules:
//   - Zero external calls: parsing is pure regex/string work (fast + free).
//   - Graceful degradation: anything we can't map lands in `unrecognized`
//     and is politely surfaced - never an error, never a blocked edit.
// ===========================================================================
import type { EditOverrides, ZoomOptions } from "./clean";

export type ParsedInstructions = {
  overrides: EditOverrides;
  applied: string[];      // human-readable summary of what was understood
  unrecognized: string[]; // fragments we couldn't map (surfaced to the user)
};

const num = (m: RegExpMatchArray | null, i = 1) => (m ? parseFloat(m[i]) : NaN);

// Named colors the caption renderer understands (mirrors CAPTION_COLORS in
// clean.ts). Longest names first so "hotpink" wins over "pink".
const COLOR_NAMES = [
  "lightgreen", "darkgreen", "lightblue", "darkblue", "lightpink", "darkgray",
  "darkgrey", "lightgray", "lightgrey", "turquoise", "lavender", "hotpink",
  "skyblue", "magenta", "crimson", "darkred", "silver", "violet", "indigo",
  "maroon", "salmon", "orange", "purple", "yellow", "cream", "beige", "coral",
  "brown", "olive", "black", "white", "green", "peach", "navy", "teal", "cyan",
  "aqua", "gold", "lime", "mint", "gray", "grey", "blue", "pink", "red",
];
const COLOR_RE = new RegExp("\\b(" + COLOR_NAMES.join("|") + ")\\b");

function matchColor(p: string): string | null {
  // "light blue" / "dark green" -> lightblue / darkgreen
  const joined = p.replace(/\b(light|dark)\s+(blue|green|pink|gray|grey|red)\b/g, "$1$2");
  const named = joined.match(COLOR_RE);
  if (named) return named[1];
  const hex = p.match(/#([0-9a-f]{6})\b/);
  if (hex) return hex[1];
  return null;
}

function matchPosition(p: string): string | null {
  if (/\b(?:top|upper)[ -]?left\b/.test(p)) return "top-left";
  if (/\b(?:top|upper)[ -]?right\b/.test(p)) return "top-right";
  if (/\b(?:bottom|lower)[ -]?left\b/.test(p)) return "bottom-left";
  if (/\b(?:bottom|lower)[ -]?right\b/.test(p)) return "bottom-right";
  if (/\btop\b|\bupper\b/.test(p)) return "top";
  if (/\b(middle|center|centre)\b/.test(p)) return "center";
  if (/\bbottom\b|\blower\b/.test(p)) return "bottom";
  return null;
}

export function parseInstructions(text: string): ParsedInstructions {
  const overrides: EditOverrides = {};
  const applied: string[] = [];
  const unrecognized: string[] = [];
  const parts = String(text || "")
    .toLowerCase()
    .split(/[.;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const zoom = (): ZoomOptions => (overrides.zoom = overrides.zoom || { enabled: true });

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

    // Keep fillers: "keep my filler words", "leave 'like' alone"
    if (/(keep|leave|don'?t (?:cut|remove))[^.]*\b(like|so|basically|literally|filler|ums?|uhs?)\b/.test(p) && !/joke/.test(p)) {
      if (/\b(filler|ums?|uhs?)\b/.test(p)) {
        overrides.keepAllFillers = true;
        applied.push("Keep all filler words (um / uh / like)");
      } else {
        overrides.keepSoftFillers = true;
        applied.push("Leave casual words (like / so / basically) alone");
      }
      hit = true;
    }

    // Remove ALL fillers: "remove all filler words", "cut every um"
    if (!overrides.keepAllFillers &&
        /(remove|cut|delete|strip|kill)[^.]*\b(all|every|the)?\s*(filler|fillers|ums?\b|uhs?\b)/.test(p) &&
        !/(keep|leave|don'?t)/.test(p)) {
      overrides.removeAllFillers = true;
      applied.push("Remove every filler word (um / uh / like / so)");
      hit = true;
    }

    // Pace: faster edit / fewer cuts
    if (/cut (?:harder|more)|\bfaster\b|snappier|tighter|more aggressive|speed (?:it |things )?up|\bquicker\b/.test(p) && !/zoom/.test(p)) {
      overrides.pace = "faster";
      applied.push("Cut harder - faster pacing");
      hit = true;
    } else if (/cut less|\bgentler\b|\bsofter\b|less aggressive|\bslower\b|fewer cuts|less cuts|too many cuts|not so many cuts/.test(p) && !/zoom/.test(p)) {
      overrides.pace = "slower";
      applied.push("Cut more gently - fewer cuts");
      hit = true;
    }

    // Keep the jokes: protect comedic timing
    if (/(keep|leave|don'?t (?:cut|remove|touch))[^.]*\b(jokes?|funny|humou?r|punchlines?)\b/.test(p)) {
      overrides.keepAllPauses = true;
      if (overrides.pace !== "faster") overrides.pace = "slower";
      applied.push("Protect the jokes - gentler cuts, comedic pauses kept");
      hit = true;
    }

    // Energetic feel
    if (/\benergetic\b|high energy|more energy|\bhype\b|\bdynamic\b|\bpunchy\b/.test(p)) {
      overrides.pace = "faster";
      const z = zoom();
      z.intensity = z.intensity || "medium";
      z.frequency = "high";
      applied.push("Energetic style - snappy pacing + lively zooms");
      hit = true;
    }

    // TikTok Shop style preset
    if (/tik ?tok shop|shop video|shoppable/.test(p)) {
      overrides.pace = "faster";
      const z = zoom();
      z.intensity = z.intensity || "medium";
      z.frequency = z.frequency || "medium";
      z.target = "product";
      const cap = overrides.captions || { enabled: true };
      cap.enabled = true;
      cap.color = cap.color || "white";
      cap.size = cap.size || "large";
      cap.position = cap.position || "bottom";
      overrides.captions = cap;
      applied.push("TikTok Shop style - captions on, snappy pace, product zooms");
      hit = true;
    }

    // Focus: product vs speaker
    if (/focus[^.]*\b(product|item)\b|show off the product|highlight the product/.test(p)) {
      const z = zoom();
      z.target = "product";
      z.intensity = z.intensity || "medium";
      applied.push("Focus on the product - zooms on demo moments");
      hit = true;
    } else if (/focus[^.]*\b(speaker|face|creator|me\b|talking)/.test(p)) {
      const z = zoom();
      z.target = "speaker";
      z.intensity = z.intensity || "subtle";
      applied.push("Focus on the speaker - subtle emphasis zooms");
      hit = true;
    }

    // Zooms: "add frequent zoom-ins", "subtle zooms", "only zoom on the
    // important moments", "aggressive zooms", "no zooms". The ENGINE picks
    // the actual moments - users never give timestamps.
    if (/zoom|punch[ -]?in|push[ -]?in/.test(p)) {
      if (/\b(no|without|disable|remove|stop|don'?t)\b/.test(p)) {
        overrides.zoom = { enabled: false };
        applied.push("No zoom effects");
      } else {
        const z = zoom();
        if (/subtle|slight|gentle|soft|light|small/.test(p)) z.intensity = "subtle";
        else if (/aggressive|strong|hard|dramatic|crash|big|intense/.test(p)) z.intensity = "strong";
        if (/frequent|lots|many|constant|every|tons/.test(p)) z.frequency = "high";
        else if (/occasional|few|rare|sparing|sometimes/.test(p)) z.frequency = "low";
        else if (/aggressive|intense/.test(p) && !z.frequency) z.frequency = "high";
        if (/important|key|crucial|big moments?|highlights?|best moments?/.test(p)) z.importantOnly = true;
        applied.push(
          "AI zooms on" +
            (z.intensity ? ` (${z.intensity})` : "") +
            (z.frequency === "high" ? ", frequent" : z.frequency === "low" ? ", occasional" : "") +
            (z.importantOnly ? ", key moments only" : "")
        );
      }
      hit = true;
    }

    // Named words: keep "X" / also remove "X"
    m = p.match(/(?:keep|never cut|don'?t (?:cut|remove))[^"'“]*["'“]([^"'”]{1,40})["'”]/);
    if (m) {
      overrides.keepWords = [...(overrides.keepWords || []), m[1]];
      applied.push(`Never cut "${m[1]}"`);
      hit = true;
    }
    m = p.match(/(?:also\s+)?(?:remove|cut)[^"'“]*["'“]([^"'”]{1,40})["'”]/);
    if (m && !(overrides.keepWords || []).includes(m[1])) {
      overrides.extraFillerWords = [...(overrides.extraFillerWords || []), m[1]];
      applied.push(`Also remove "${m[1]}"`);
      hit = true;
    }

    // Captions: "add captions", "make the captions dark blue", "boxed captions
    // top-right", "small minimal subtitles"
    if (/captions?|subtitles?/.test(p)) {
      const cap = overrides.captions || { enabled: true };
      cap.enabled = !/\b(no|without|remove|disable)\b/.test(p);
      const color = matchColor(p);
      if (color) cap.color = color;
      if (/\b(big|large|huge)\b/.test(p)) cap.size = "large";
      else if (/\b(small|tiny)\b/.test(p)) cap.size = "small";
      const pos = matchPosition(p);
      if (pos) cap.position = pos as NonNullable<typeof cap.position>;
      if (/\b(boxed?|background|banner)\b/.test(p)) cap.style = "boxed";
      else if (/\b(minimal|clean|simple|thin|plain)\b/.test(p)) cap.style = "minimal";
      overrides.captions = cap;
      applied.push(
        cap.enabled
          ? `Captions on${cap.color ? ` (${cap.color})` : ""}${cap.size ? `, ${cap.size}` : ""}${cap.position ? `, ${cap.position}` : ""}${cap.style && cap.style !== "outline" ? `, ${cap.style}` : ""}`
          : "Captions off"
      );
      hit = true;
    }

    if (!hit) unrecognized.push(p);
  }

  return { overrides, applied, unrecognized };
}
