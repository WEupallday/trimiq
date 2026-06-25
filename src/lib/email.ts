// Minimal transactional email via Resend (https://resend.com).
// Set RESEND_API_KEY (and optionally EMAIL_FROM) in the environment.
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "TrimIQ <onboarding@resend.dev>";

  if (!key) {
    // No provider configured yet — log so the link is recoverable during setup.
    console.warn(`[email] RESEND_API_KEY not set; would send to ${to}: ${subject}`);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error("[email] Resend error", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] send failed", e);
    return false;
  }
}

export function resetEmailHtml(link: string): string {
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0b1020">
    <h2 style="margin:0 0 12px">Reset your TrimIQ password</h2>
    <p style="color:#475569;line-height:1.5">We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#6366f1;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">Reset password</a>
    </p>
    <p style="color:#94a3b8;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    <p style="color:#94a3b8;font-size:13px;word-break:break-all">Or paste this link into your browser:<br>${link}</p>
  </div>`;
}
