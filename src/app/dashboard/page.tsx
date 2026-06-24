import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import LogoutButton from "@/components/LogoutButton";
import { getSession } from "@/lib/auth";
import UploadStudio from "./UploadStudio";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo size={32} />
            TrimIQ
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-white/50 sm:inline">{session.email}</span>
            <span className="glass rounded-full px-3 py-1.5 text-xs text-white/70">
              Free plan · 5 edits left
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-14">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Clean a video</h1>
          <p className="mt-3 text-white/60">
            Upload your raw clip and TrimIQ removes the dead space automatically.
          </p>
        </div>

        <UploadStudio />
      </section>
    </main>
  );
}
