// Admin access control + dashboard data.
// Access is granted ONLY to accounts whose DB `isAdmin` flag is true, OR whose
// email is listed in the ADMIN_EMAILS env var (the secure bootstrap). A username
// like "admin" grants nothing.
import { prisma } from "./db";
import { getSession, type Session } from "./auth";
import { getPlan } from "./plans";
import { effectiveEditLimit, CREATOR_BETA_EDITS } from "./credits";
import { jobs, queueDepth } from "./jobs";
import { getLivePrices } from "./stripe";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdminEmail(email: string): Promise<boolean> {
  if (adminEmails().includes(email.toLowerCase())) return true;
  const u = await prisma.user.findUnique({ where: { email }, select: { isAdmin: true } });
  return !!u?.isAdmin;
}

// Returns the session only if the caller is an admin; otherwise null.
export async function requireAdmin(): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  return (await isAdminEmail(session.email)) ? session : null;
}

const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function adminData() {
  const today = dayStart();

  const [users, jobsTotal, jobsToday, jobsFailed, jobAgg, creatorBetaVideos, feedback] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.processingJob.count(),
    prisma.processingJob.count({ where: { createdAt: { gte: today } } }),
    prisma.processingJob.count({ where: { status: "error" } }),
    prisma.processingJob.aggregate({ _avg: { durationMs: true }, where: { status: "done" } }),
    prisma.processingJob.count({ where: { creatorBeta: true } }),
    prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const recentErrors = await prisma.processingJob.findMany({
    where: { status: "error" },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  // User / subscription rollups.
  const newToday = users.filter((u) => u.createdAt >= today).length;
  const active = users.filter((u) => u.subscriptionStatus === "active").length;
  const trialing = users.filter((u) => u.subscriptionStatus === "trialing").length;
  const canceled = users.filter((u) => u.subscriptionStatus === "canceled").length;
  const paid = users.filter((u) => u.plan !== "free").length;
  const free = users.length - paid;
  const creatorBetaUsers = users.filter((u) => u.isCreatorBeta).length;

  // Live prices straight from Stripe (no hardcoded amounts anywhere).
  const prices = await getLivePrices();

  // MRR: sum of the live monthly price for users with an active paid subscription.
  const mrr = users
    .filter((u) => u.subscriptionStatus === "active" && u.plan !== "free")
    .reduce((sum, u) => sum + ((prices as any)[u.plan]?.amount || 0), 0);

  return {
    users: users.map((u) => {
      const limit = effectiveEditLimit(u.plan, u.isCreatorBeta);
      return {
        id: u.id,
        email: u.email,
        username: u.username,
        tiktokUsername: u.tiktokUsername,
        plan: u.plan,
        planName: getPlan(u.plan).name,
        editLimit: isFinite(limit) ? limit : null,
        editsUsed: u.editsUsed,
        creditsLeft: isFinite(limit) ? Math.max(0, limit - u.editsUsed) : null,
        isAdmin: u.isAdmin,
        isCreatorBeta: u.isCreatorBeta,
        suspended: u.suspended,
        subscriptionStatus: u.subscriptionStatus,
        createdAt: u.createdAt.toISOString(),
      };
    }),
    stats: {
      totalUsers: users.length,
      newToday,
      active,
      trialing,
      canceled,
      paid,
      free,
      mrr,
      creatorBetaUsers,
      creatorBetaVideos,
      creatorBetaEdits: CREATOR_BETA_EDITS,
      videosTotal: jobsTotal,
      videosToday: jobsToday,
      videosFailed: jobsFailed,
      avgProcessingMs: Math.round(jobAgg._avg.durationMs || 0),
      pricing: {
        starter: prices.starter.amount,
        pro: prices.pro.amount,
        unlimited: prices.unlimited.amount,
        currency: prices.pro.currency || "usd",
      },
    },
    system: {
      status: "online",
      queueDepth: queueDepth(),
      processing: Array.from(jobs.values()).filter((j) => j.status === "processing").length,
    },
    recentErrors: recentErrors.map((e) => ({
      name: e.name,
      email: e.email,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
    })),
    feedback: feedback.map((f) => ({
      email: f.email,
      rating: f.rating,
      comment: f.comment,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}
