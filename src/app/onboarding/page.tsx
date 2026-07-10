import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Onboarding from "@/components/Onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // If they've already added a TikTok handle, no need to prompt again.
  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (user?.tiktokUsername) redirect("/dashboard");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <div className="mb-8 flex items-center gap-2 font-semibold">
          <Logo size={36} />
          <span className="text-xl">TrimIQ</span>
        </div>
        <Onboarding />
      </div>
    </main>
  );
}
