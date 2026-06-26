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
import { getStripe, priceIdFor, getOrCreateCustomer, syncSubscription } from "@/lib/stripe";
import { getPlan, type PlanId } from "@/lib/plans";

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

  const { planId } = await req.json().catch(() => ({ planId: "" }));
  const plan = getPlan(planId);
  const user = await prisma.user.findUnique({ where: { email: session.email } });

  // Downgrade to free = cancel any active subscription.
  if (plan.id === "free") {
    if (user?.stripeSubscriptionId) {
      await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true } as any);
    }
    return NextResponse.json({ ok: true, message: "Your plan will switch to Free at the end of the period." });
  }

  const priceId = await priceIdFor(stripe, plan.id as PlanId);

  // Already subscribed -> change the plan in place (upgrade/downgrade).
  if (user?.stripeSubscriptionId && user.subscriptionStatus === "active") {
    const sub: any = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [{ id: sub.items.data[0].id, price: priceId }],
      proration_behavior: "create_prorations",
      metadata: { planId: plan.id, email: session.email },
    } as any);
    return NextResponse.json({ changed: true, message: `Switched to ${plan.name}.` });
  }

  // New subscription -> Stripe Checkout.
  const customer = await getOrCreateCustomer(stripe, session.email);
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
}

async function handleCancel(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (!user?.stripeSubscriptionId) {
    return NextResponse.json({ error: "No active subscription to cancel." }, { status: 400 });
  }
  await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true } as any);
  return NextResponse.json({ ok: true, message: "Your subscription will end at the close of the current period." });
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
    const plan = user?.plan ?? "free";
    if (creditsLeft(plan, user?.editsUsed ?? 0) <= 0) {
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
      })
      .catch((err) => {
        console.error("PROCESS ERROR:", err);
        job.status = "error";
        job.error = friendlyError(err);
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
