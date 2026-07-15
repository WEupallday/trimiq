// ===========================================================================
// TikTok Events API (server-side) — TrimIQ
//
// Sends conversion events to TikTok's Events API v1.3, DEDUPLICATED against the
// browser Pixel via a shared `event_id`. Advanced-matching identifiers
// (email / phone / external_id) are SHA-256 hashed before they ever leave the
// server, per TikTok's requirements. Every call is wrapped so a TikTok outage,
// bad token, or network error can NEVER break app functionality — failures are
// caught, logged, and swallowed.
//
// ENV VARS:
//   NEXT_PUBLIC_TIKTOK_PIXEL_ID  (public) — the Pixel code. Default below is the
//                                 authoritative ID from Events Manager; override
//                                 in Render to swap pixels without a code change.
//   TIKTOK_ACCESS_TOKEN          (secret) — Events API token. Get it from
//                                 Events Manager -> [your pixel] -> Settings ->
//                                 "Events API" -> Generate Access Token.
// ===========================================================================
import { createHash, randomUUID } from "node:crypto";

const API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const DEFAULT_PIXEL_ID = "D9BFVS3C77U7PB56R3N0";

export function ttPixelId(): string {
  return (process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || DEFAULT_PIXEL_ID).trim();
}

function accessToken(): string | null {
  const t = (process.env.TIKTOK_ACCESS_TOKEN || "").trim();
  return t || null;
}

// A fresh id to share between the browser Pixel event and the server event so
// TikTok collapses the pair into one (dedup).
export function newEventId(): string {
  return randomUUID();
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function hashEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const e = email.trim().toLowerCase();
  return e ? sha256(e) : undefined;
}
function hashPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  // E.164-ish: strip everything but digits and a leading +.
  const p = phone.replace(/[^0-9+]/g, "");
  return p ? sha256(p) : undefined;
}
function hashId(id?: string | null): string | undefined {
  if (!id) return undefined;
  const s = String(id).trim();
  return s ? sha256(s) : undefined;
}

export type TikTokEventName =
  | "PageView"
  | "ViewContent"
  | "CompleteRegistration"
  | "StartTrial"
  | "InitiateCheckout"
  | "Purchase"
  | "Subscribe"
  | "AddToCart";

export interface TikTokEventInput {
  event: TikTokEventName;
  event_id?: string; // shared with the pixel for dedup (auto-generated if omitted)
  eventTime?: number; // unix seconds (defaults to now)
  url?: string;
  referrer?: string;
  ip?: string | null;
  userAgent?: string | null;
  email?: string | null;
  phone?: string | null;
  externalId?: string | null; // a STABLE per-user id (we use the user's DB id)
  ttclid?: string | null; // TikTok click id, from ?ttclid= on landing
  ttp?: string | null; // _ttp cookie value set by the pixel
  value?: number; // Purchase / InitiateCheckout amount
  currency?: string; // e.g. "USD"
  contents?: Array<{
    content_id?: string;
    content_name?: string;
    content_type?: string;
    price?: number;
    quantity?: number;
  }>;
  properties?: Record<string, unknown>;
}

export interface TikTokSendResult {
  ok: boolean;
  skipped?: boolean; // token not configured — no-op
  code?: number;
  message?: string;
  error?: string;
  event_id?: string;
}

// Fire-and-catch a single event. Awaitable, but designed so callers can also
// `void sendTikTokEvent(...)` without risk. Times out fast so a slow TikTok
// never noticeably delays a request.
export async function sendTikTokEvent(input: TikTokEventInput): Promise<TikTokSendResult> {
  const token = accessToken();
  const pixel = ttPixelId();
  const event_id = input.event_id || newEventId();

  if (!token || !pixel) {
    // Not wired up yet — silently no-op. This is the ONLY path that runs until
    // TIKTOK_ACCESS_TOKEN is set in the environment.
    return { ok: false, skipped: true, event_id };
  }

  try {
    // Advanced matching (all hashed except ip/user_agent/ttp/ttclid which TikTok
    // wants raw).
    const user: Record<string, unknown> = {};
    const em = hashEmail(input.email);
    if (em) user.email = em;
    const ph = hashPhone(input.phone);
    if (ph) user.phone = ph;
    const ex = hashId(input.externalId);
    if (ex) user.external_id = ex;
    if (input.ip) user.ip = input.ip;
    if (input.userAgent) user.user_agent = input.userAgent;
    if (input.ttp) user.ttp = input.ttp;
    if (input.ttclid) user.ttclid = input.ttclid;

    const properties: Record<string, unknown> = { ...(input.properties || {}) };
    if (typeof input.value === "number") properties.value = input.value;
    if (input.currency) properties.currency = input.currency;
    if (input.contents && input.contents.length) properties.contents = input.contents;

    const page =
      input.url || input.referrer ? { url: input.url, referrer: input.referrer } : undefined;

    const body = {
      event_source: "web",
      event_source_id: pixel,
      data: [
        {
          event: input.event,
          event_time: input.eventTime || Math.floor(Date.now() / 1000),
          event_id,
          user,
          ...(page ? { page } : {}),
          ...(Object.keys(properties).length ? { properties } : {}),
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const json: any = await res.json().catch(() => ({}));
    // TikTok returns { code: 0, message: "OK", ... } on success.
    if (json && json.code === 0) {
      return { ok: true, code: 0, message: json.message, event_id };
    }
    console.error(
      "[TIKTOK] event rejected:",
      input.event,
      "code=",
      json?.code,
      "message=",
      json?.message || res.statusText
    );
    return { ok: false, code: json?.code, message: json?.message || res.statusText, event_id };
  } catch (e) {
    // Network / timeout / anything — never rethrow.
    console.error("[TIKTOK] event send failed:", input.event, (e as any)?.message || e);
    return { ok: false, error: (e as any)?.message || "send failed", event_id };
  }
}

// -------- Request context helper (Next.js route handlers) ------------------
// Pulls the IP, user-agent, ?ttclid=, and _ttp cookie off an incoming request
// so server events carry the same signals the pixel would.
export function tiktokContextFromRequest(req: {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined };
  nextUrl?: { searchParams: URLSearchParams; href?: string };
  url?: string;
}): {
  ip: string | null;
  userAgent: string | null;
  ttclid: string | null;
  ttp: string | null;
  url: string | null;
  referrer: string | null;
} {
  const xf = req.headers.get("x-forwarded-for") || "";
  const ip = xf.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent");
  const referrer = req.headers.get("referer") || req.headers.get("referrer");
  let ttclid: string | null = null;
  let url: string | null = req.url || null;
  try {
    if (req.nextUrl) {
      ttclid = req.nextUrl.searchParams.get("ttclid");
      url = req.nextUrl.href || url;
    }
  } catch {
    /* ignore */
  }
  let ttp: string | null = null;
  try {
    ttp = req.cookies?.get("_ttp")?.value || null;
    if (!ttclid) ttclid = req.cookies?.get("ttclid")?.value || null;
  } catch {
    /* ignore */
  }
  return { ip, userAgent, ttclid, ttp, url, referrer };
}
