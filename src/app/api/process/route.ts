import { NextRequest, NextResponse } from "next/server";
import { unlink, mkdtemp, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo, type EditMode } from "@/lib/clean";
import { createJob, getJob, listJobs, removeJob, runExclusive } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { creditsLeft } from "@/lib/credits";
import { getStripe, priceIdForPlan, getOrCreateCustomer, syncSubscription, planFromSub } from "@/lib/stripe";
import { getPlan } from "@/lib/plans";
import { requireAdmin, adminData } from "@/lib/admin";
import { notify, notificationsEnabled } from "@/lib/notify";

// ----- Admin: dashboard data + actions -------------------------------------
async function handleAdminData() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  return NextResponse.json(await adminData());
}

async function handleAdminAction(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const { action, userId, plan } = await req.json();
    if (action === "testNotification") {
      if (!notificationsEnabled()) {
        return NextResponse.json({ error: "Notifications aren't configured. Set DISCORD_WEBHOOK_URL first." }, { status: 400 });
      }
      await notify("test", { message: "TrimIQ notifications are working", triggeredBy: admin.email });
      return NextResponse.json({ ok: true, sent: true });
    }
    if (!userId) return NextResponse.json({ error: "Missing user." }, { status: 400 });
    if (action === "resetCredits") {
      await prisma.user.update({ where: { id: userId }, data: { editsUsed: 0 } });
    } else if (action === "setPlan") {
      await prisma.user.update({ where: { id: userId }, data: { plan: getPlan(plan).id, editsUsed: 0 } });
    } else if (action === "suspend") {
      await prisma.user.update({ where: { id: userId }, data: { suspended: true } });
    } else if (action === "unsuspend") {
      await prisma.user.update({ where: { id: userId }, data: { suspended: false } });
    } else if (action === "markCreatorBeta") {
      const u = await prisma.user.update({ where: { id: userId }, data: { isCreatorBeta: true } });
      await notify("creator_beta", { email: u.email, username: u.username, plan: getPlan(u.plan).name });
    } else if (action === "unmarkCreatorBeta") {
      await prisma.user.update({ where: { id: userId }, data: { isCreatorBeta: false } });
    } else if (action === "delete") {
      await prisma.user.delete({ where: { id: userId } });
    } else if (action === "migratePricing") {
      // Move an existing subscriber onto the current Stripe Price for their tier.
      // Switches the price on the existing subscription (never recreates it) with
      // no proration, so the new amount simply applies from the next renewal.
      const stripe = getStripe();
      if (!stripe) return NextResponse.json({ error: "Billing isn't set up." }, { status: 503 });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.stripeCustomerId) {
        return NextResponse.json({ error: "This user has no Stripe customer / subscription." }, { status: 400 });
      }
      const actives = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: "active", limit: 10 });
      if (actives.data.length === 0) {
        return NextResponse.json({ error: "No active subscription to migrate." }, { status: 400 });
      }
      const sub: any = actives.data[0];
      const detected = planFromSub(sub) || user.plan || "free";
      const newPrice = priceIdForPlan(detected);
      if (!newPrice) {
        return NextResponse.json({ error: `No Stripe Price configured for the ${detected} plan. Set its STRIPE_PRICE_* env var first.` }, { status: 400 });
      }
      if (sub.items.data[0].price.id === newPrice) {
        return NextResponse.json({ ok: true, message: "Already on current pricing." });
      }
      const updated: any = await stripe.subscriptions.update(sub.id, {
        items: [{ id: sub.items.data[0].id, price: newPrice }],
        proration_behavior: "none",
        metadata: { ...(sub.metadata || {}), planId: detected, email: user.email },
      } as any);
      await syncSubscription(updated, false);
      return NextResponse.json({ ok: true, message: `Migrated to current ${detected} pricing.` });
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("ADMIN ACTION ERROR:", e);
    return NextResponse.json({ error: e?.message || "Action failed." }, { status: 400 });
  }
}

// ----- Account: change username --------------------------------------------
async function handleAccountUsername(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  try {
    const { username } = await req.json();
    const u = String(username || "").trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
      return NextResponse.json({ error: "Username must be 3–20 letters, numbers, or underscores." }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { username: u } });
    if (existing && existing.email !== session.email) {
      return NextResponse.json({ error: "That username is taken." }, { status: 409 });
    }
    await prisma.user.update({ where: { email: session.email }, data: { username: u } });
    return NextResponse.json({ ok: true, username: u });
  } catch {
    return NextResponse.json({ error: "Couldn't update username." }, { status: 400 });
  }
}

// ----- Account: add / update / remove TikTok username (optional) ------------
async function handleAccountTiktok(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  try {
    const { tiktokUsername } = await req.json();
    // Accept with or without a leading @; empty value clears it.
    const raw = String(tiktokUsername ?? "").trim().replace(/^@+/, "");
    if (raw === "") {
      await prisma.user.update({ where: { email: session.email }, data: { tiktokUsername: null } });
      return NextResponse.json({ ok: true, tiktokUsername: null });
    }
    if (!/^[a-zA-Z0-9._]{2,24}$/.test(raw)) {
      return NextResponse.json(
        { error: "Enter a valid TikTok handle (2–24 letters, numbers, periods, or underscores)." },
        { status: 400 }
      );
    }
    await prisma.user.update({ where: { email: session.email }, data: { tiktokUsername: raw } });
    return NextResponse.json({ ok: true, tiktokUsername: raw });
  } catch {
    return NextResponse.json({ error: "Couldn't update TikTok username." }, { status: 400 });
  }
}

function originFrom(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return process.env.APP_URL || (host ? `${proto}://${host}` : req.nextUrl.origin);
}

// ----- Stripe: create checkout / change plan -------------------------------
async function handleCheckout(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  try {
  const { planId } = await req.json().catch(() => ({ planId: "" }));
  const plan = getPlan(planId);

  // Use Stripe's live list of subscriptions as the source of truth. This makes
  // duplicate active subscriptions impossible even if the DB is briefly stale.
  const customer = await getOrCreateCustomer(stripe, session.email);
  const actives = await stripe.subscriptions.list({ customer, status: "active", limit: 10 });

  // Downgrade to Free = cancel every active subscription at period end.
  if (plan.id === "free") {
    for (const s of actives.data) {
      await stripe.subscriptions.update(s.id, { cancel_at_period_end: true } as any);
    }
    return NextResponse.json({ ok: true, message: "Your plan will switch to Free at the end of the current period." });
  }

  const priceId = priceIdForPlan(plan.id);
  if (!priceId) {
    return NextResponse.json(
      { error: `Pricing isn't configured for the ${plan.name} plan yet. Set ${plan.priceEnvVar} (its Stripe Price ID) in the environment.` },
      { status: 503 }
    );
  }

  // Already subscribed -> change the existing subscription in place (no new one).
  if (actives.data.length > 0) {
    const sub: any = actives.data[0];
    const updated: any = await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: priceId }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false, // reactivate if a cancel was pending
      metadata: { planId: plan.id, email: session.email },
    } as any);
    // Guarantee a single active subscription: cancel any extras.
    for (const extra of actives.data.slice(1)) {
      await (stripe.subscriptions as any).cancel(extra.id).catch(() => {});
    }
    // Sync the DB right away so the dashboard reflects the new plan immediately.
    await syncSubscription(updated, false);
    return NextResponse.json({ changed: true, message: `Switched to ${plan.name}.` });
  }

  // No active subscription -> start Stripe Checkout for a new one.
  const origin = originFrom(req);
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { planId: plan.id, email: session.email } },
    metadata: { planId: plan.id, email: session.email },
    success_url: `${origin}/dashboard?upgraded=1`,
    cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: true,
  } as any);
  return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    console.error("CHECKOUT ERROR:", e?.message || e);
    const auth = e?.statusCode === 401 || /api key|authentication/i.test(e?.message || "");
    const msg = auth
      ? "Stripe rejected the API key. In Render, set STRIPE_SECRET_KEY to your SECRET key (starts with sk_test_), not the publishable key (pk_test_)."
      : e?.message || "Couldn't start checkout. Please try again.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

async function handleCancel(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
  try {
    const customer = await getOrCreateCustomer(stripe, session.email);
    const actives = await stripe.subscriptions.list({ customer, status: "active", limit: 10 });
    if (actives.data.length === 0) {
      return NextResponse.json({ error: "No active subscription to cancel." }, { status: 400 });
    }
    for (const s of actives.data) {
      await stripe.subscriptions.update(s.id, { cancel_at_period_end: true } as any);
    }
    return NextResponse.json({ ok: true, message: "Your subscription will end at the close of the current period." });
  } catch (e: any) {
    console.error("CANCEL ERROR:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Couldn't cancel. Please try again." }, { status: 400 });
  }
}

// ----- Stripe: webhook (keeps the DB in sync with payments) ----------------
async function handleWebhook(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("WEBHOOK SIGNATURE ERROR:", e);
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.subscription) {
          const sub: any = await stripe.subscriptions.retrieve(s.subscription);
          if (!sub.metadata?.email && s.metadata?.email) sub.metadata = s.metadata;
          await syncSubscription(sub, true);
          // A completed Checkout = a brand-new paid subscription.
          await notify("subscription", {
            email: sub.metadata?.email,
            plan: getPlan(planFromSub(sub) ?? undefined).name,
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        await syncSubscription(event.data.object, false);
        break;
      }
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object, false);
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        if (inv.subscription) {
          const sub: any = await stripe.subscriptions.retrieve(inv.subscription);
          await syncSubscription(sub, true);
        }
        break;
      }
    }
  } catch (e) {
    console.error("WEBHOOK HANDLER ERROR:", e);
  }
  return NextResponse.json({ received: true });
}

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES: EditMode[] = ["light", "balanced", "aggressive"];
const MAX_BYTES = 600 * 1024 * 1024; // hard server ceiling; client warns earlier

// Turn raw ffmpeg/ffprobe failures into clear, user-friendly messages.
function friendlyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/invalid data|could not find codec|moov atom|does not contain|no such file|Invalid data found/i.test(m)) {
    return "We couldn't read that file. Please upload a valid video (MP4, MOV, etc.).";
  }
  if (/killed|out of memory|cannot allocate|signal 9/i.test(m)) {
    return "This video was too large to process at full quality. Try a shorter clip or a 1080p version.";
  }
  return "Something went wrong while editing. Please try again, or try a different clip.";
}

function downloadName(originalName: string): string {
  const base = (originalName || "video").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "video";
  return `${base}-trimiq.mp4`;
}

// Store a beta user's rating + comment (POST /api/process?feedback=1).
async function handleFeedback(req: NextRequest) {
  try {
    const { rating, comment } = await req.json();
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return NextResponse.json({ error: "Rating must be between 1 and 5." }, { status: 400 });
    }
    const session = await getSession();
    await prisma.feedback.create({
      data: {
        email: session?.email ?? null,
        rating: r,
        comment: typeof comment === "string" ? comment.slice(0, 2000) : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("FEEDBACK ERROR:", e);
    return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  }
}

// POST: receive the upload, start editing in the background, return a job id fast.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("feedback") === "1") {
    return handleFeedback(req);
  }
  const stripeAction = req.nextUrl.searchParams.get("stripe");
  if (stripeAction === "webhook") return handleWebhook(req);
  if (stripeAction === "checkout") return handleCheckout(req);
  if (stripeAction === "cancel") return handleCancel(req);
  if (req.nextUrl.searchParams.get("admin") === "action") return handleAdminAction(req);
  if (req.nextUrl.searchParams.get("account") === "username") return handleAccountUsername(req);
  if (req.nextUrl.searchParams.get("account") === "tiktok") return handleAccountTiktok(req);

  let inPath = "";
  try {
    if (!req.body) {
      return NextResponse.json({ error: "No video received. Please choose a file and try again." }, { status: 400 });
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Your session expired. Please log in again." }, { status: 401 });
    }
    const user = await prisma.user.findUnique({ where: { email: session.email } });
    if (user?.suspended) {
      return NextResponse.json({ error: "This account is suspended. Please contact support." }, { status: 403 });
    }
    const plan = user?.plan ?? "free";
    if (creditsLeft(plan, user?.editsUsed ?? 0, user?.isCreatorBeta) <= 0) {
      return NextResponse.json(
        { error: "You've used all your free edits. Upgrade to keep editing.", outOfCredits: true },
        { status: 402 }
      );
    }

    const modeRaw = (req.nextUrl.searchParams.get("mode") || "balanced") as EditMode;
    const mode: EditMode = MODES.includes(modeRaw) ? modeRaw : "balanced";
    const originalName = (req.nextUrl.searchParams.get("name") || "video.mp4").slice(0, 200);

    const dir = await mkdtemp(join(tmpdir(), "trimiq-"));
    const id = randomUUID();
    inPath = join(dir, `${id}-in.mp4`);
    const outPath = join(dir, `${id}-out.mp4`);

    await pipeline(Readable.fromWeb(req.body as any), createWriteStream(inPath));

    const { size } = await stat(inPath);
    if (size < 1024) {
      await unlink(inPath).catch(() => {});
      return NextResponse.json({ error: "That file looks empty or didn't upload fully. Please try again." }, { status: 400 });
    }
    if (size > MAX_BYTES) {
      await unlink(inPath).catch(() => {});
      return NextResponse.json(
        { error: "That video is too large. Please use a clip under 500 MB (record in 1080p, not 4K)." },
        { status: 413 }
      );
    }

    const job = createJob(session.email, originalName);
    job.inputPath = inPath;
    job.outputPath = outPath;
    const startedAt = Date.now();

    runExclusive(() =>
      cleanVideo(inPath, outPath, { mode, fileBytes: size, onStage: (s) => (job.stage = s) })
    )
      .then(async (result) => {
        job.status = "done";
        job.stats = {
          original: result.original,
          cleaned: result.cleaned,
          removed: result.removed,
          cuts: result.cuts,
          percent: result.percentRemoved,
          capped: result.capped,
        };
        await prisma.user
          .update({ where: { email: session.email }, data: { editsUsed: { increment: 1 } } })
          .catch((e) => console.error("CREDIT UPDATE ERROR:", e));
        await prisma.processingJob
          .create({ data: { email: session.email, name: originalName, status: "done", durationMs: Date.now() - startedAt, creatorBeta: !!user?.isCreatorBeta } })
          .catch(() => {});
        // Notify on the user's very first successful video.
        const doneCount = await prisma.processingJob
          .count({ where: { email: session.email, status: "done" } })
          .catch(() => 0);
        if (doneCount === 1) {
          await notify("first_video", {
            email: session.email,
            username: user?.username,
            plan: getPlan(user?.plan).name,
            seconds: ((Date.now() - startedAt) / 1000).toFixed(1),
          });
        }
      })
      .catch(async (err) => {
        console.error("PROCESS ERROR:", err);
        job.status = "error";
        job.error = friendlyError(err);
        await prisma.processingJob
          .create({ data: { email: session.email, name: originalName, status: "error", durationMs: Date.now() - startedAt, error: job.error, creatorBeta: !!user?.isCreatorBeta } })
          .catch(() => {});
        await notify("job_failed", {
          email: session.email,
          username: user?.username,
          video: originalName,
          error: job.error,
        });
      })
      .finally(() => {
        unlink(inPath).catch(() => {});
      });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    if (inPath) await unlink(inPath).catch(() => {});
    console.error("UPLOAD ERROR:", err);
    return NextResponse.json(
      { error: "Upload failed. Please check your connection and try again." },
      { status: 500 }
    );
  }
}

// GET: poll a job, download a finished video, or list the user's recent projects.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Admin dashboard data.
  if (params.get("admin") === "data") return handleAdminData();

  // List recent projects for the logged-in user.
  if (params.get("list") === "1") {
    const session = await getSession();
    if (!session) return NextResponse.json({ projects: [] });
    const projects = listJobs(session.email).map((j) => ({
      id: j.id,
      name: j.originalName,
      createdAt: j.createdAt,
      status: j.status,
      stage: j.stage,
      error: j.error ?? null,
      stats: j.status === "done" ? j.stats : null,
    }));
    return NextResponse.json({ projects });
  }

  const id = params.get("jobId");
  if (!id) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "That project is no longer available." }, { status: 404 });

  // Ownership check.
  const session = await getSession();
  if (job.email && session?.email !== job.email) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  if (params.get("download") === "1") {
    if (job.status !== "done" || !job.outputPath) {
      return NextResponse.json({ error: "This edit isn't ready yet." }, { status: 409 });
    }
    const data = await readFile(job.outputPath).catch(() => null);
    if (!data) return NextResponse.json({ error: "This file is no longer available." }, { status: 410 });
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${downloadName(job.originalName)}"`,
      },
    });
  }

  return NextResponse.json({
    status: job.status,
    stage: job.stage,
    error: job.error ?? null,
    stats: job.status === "done" ? job.stats : null,
  });
}

// DELETE: remove a project (file + record) for the logged-in owner.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("jobId");
  if (!id) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const job = getJob(id);
  if (job && job.email !== session.email) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  removeJob(id);
  return NextResponse.json({ ok: true });
}
