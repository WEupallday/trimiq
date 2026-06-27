// Founder notification service.
//
// Sends a Discord embed to the webhook in DISCORD_WEBHOOK_URL. If that env var
// isn't set, every call is a silent no-op, so the app runs fine without it.
//
// Modular by design: to add a new event, add one entry to EVENT_META and call
//   notify("my_event", { any: "fields", you: "want" })
// from anywhere. notify() NEVER throws — failures are logged and swallowed so a
// notification problem can never break a signup, payment, or render.

export type NotifyEvent =
  | "signup"
  | "creator_beta"
  | "subscription"
  | "first_video"
  | "job_failed"
  | "test";

const EVENT_META: Record<NotifyEvent, { title: string; emoji: string; color: number }> = {
  signup: { title: "New signup", emoji: "🎉", color: 0x6366f1 },
  creator_beta: { title: "Creator Beta approved", emoji: "⭐", color: 0xf59e0b },
  subscription: { title: "New paid subscription", emoji: "💳", color: 0x22c55e },
  first_video: { title: "First video processed", emoji: "🎬", color: 0x38bdf8 },
  job_failed: { title: "Video processing failed", emoji: "⚠️", color: 0xef4444 },
  test: { title: "Test notification", emoji: "🔔", color: 0x94a3b8 },
};

type FieldValue = string | number | null | undefined;

function webhookUrl(): string {
  return (process.env.DISCORD_WEBHOOK_URL || "").trim();
}

export function notificationsEnabled(): boolean {
  return webhookUrl().length > 0;
}

// Title-cases a snake/camel field key for nicer Discord labels.
function label(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

async function postToDiscord(body: unknown): Promise<void> {
  const url = webhookUrl();
  if (!url) return; // not configured -> no-op

  // One quick retry for transient network/5xx hiccups; bounded so it never hangs.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok || res.status === 204) return;
      // 4xx (bad webhook, rate limit handled by Discord) -> don't spin.
      if (res.status < 500) {
        console.error(`NOTIFY: Discord responded ${res.status}`);
        return;
      }
    } catch (e) {
      console.error("NOTIFY: send failed:", (e as any)?.message || e);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Fire a founder notification. Safe to await or fire-and-forget; never throws.
 */
export async function notify(event: NotifyEvent, fields: Record<string, FieldValue> = {}): Promise<void> {
  try {
    const meta = EVENT_META[event];
    if (!meta) return;

    const embedFields = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => ({ name: label(k), value: String(v).slice(0, 1024), inline: true }));

    await postToDiscord({
      username: "TrimIQ",
      embeds: [
        {
          title: `${meta.emoji} ${meta.title}`,
          color: meta.color,
          fields: embedFields,
          timestamp: new Date().toISOString(),
          footer: { text: "TrimIQ" },
        },
      ],
    });
  } catch (e) {
    // Absolutely never let a notification break the calling flow.
    console.error("NOTIFY: unexpected error:", (e as any)?.message || e);
  }
}
