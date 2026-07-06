import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import LogoutButton from "@/components/LogoutButton";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import DiscoverGrid from "@/components/DiscoverGrid";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = await isAdminEmail(session.email);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo size={32} />
            TrimIQ <span className="text-sm font-normal text-white/40">Discover</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-white/60 transition hover:text-white">Editor</Link>
            {admin && (
              <Link href="/admin" className="rounded-lg border border-indigo-400/40 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/10">Admin</Link>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Viral Products</h1>
          <p className="mt-2 text-white/60">
            Trending TikTok Shop products ranked by momentum. Find a winner, then turn it into an ad in one click.
          </p>
        </div>
        <DiscoverGrid isAdmin={admin} />
      </section>
    </main>
  );
}
