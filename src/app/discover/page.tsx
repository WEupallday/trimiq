import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import LogoutButton from "@/components/LogoutButton";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import DiscoverGrid, { type DiscoverInitial } from "@/components/DiscoverGrid";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { window?: string; category?: string; sort?: string; breakout?: string; q?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = await isAdminEmail(session.email);

  const win = Number(searchParams.window);
  const initial: DiscoverInitial = {
    window: [7, 30, 90].includes(win) ? win : 7,
    category: searchParams.category || "all",
    sort: searchParams.sort || "trend",
    breakout: searchParams.breakout === "1",
    q: searchParams.q || "",
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full bg-indigo-600/15 blur-[130px]" />
      <div className="pointer-events-none absolute top-[500px] -left-40 h-[380px] w-[380px] rounded-full bg-fuchsia-600/10 blur-[130px]" />

      <header className="relative z-20 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/discover" className="flex items-center gap-2 font-semibold">
            <Logo size={32} />
            TrimIQ
          </Link>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white">Discover</span>
            <Link href="/dashboard" className="text-sm text-white/55 transition hover:text-white">Editor</Link>
            {admin && (
              <Link href="/admin" className="rounded-lg border border-indigo-400/40 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/10">Admin</Link>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Market intelligence
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">Find winning products.</h1>
          <p className="mt-3 max-w-2xl text-lg text-white/60">
            Trending TikTok Shop products, ranked by real momentum — not just total sales. Spot a winner, then turn it into an ad in one click.
          </p>
        </div>
        <DiscoverGrid isAdmin={admin} initial={initial} />
      </section>
    </main>
  );
}
