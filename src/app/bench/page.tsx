import { redirect } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { requireAdmin } from "@/lib/admin";
import BenchRunner from "./BenchRunner";

export const dynamic = "force-dynamic";

export default async function BenchPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Logo size={28} /> TrimIQ
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-normal text-white/60">Benchmark</span>
        </Link>
        <Link href="/admin" className="text-sm text-white/50 transition hover:text-white">Admin →</Link>
      </div>
      <h1 className="text-2xl font-bold">Engine benchmark</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/50">
        Run the same baseline clips after every engine change. Each run is scored and stored
        per engine version, so quality regressions show up immediately in the history table.
      </p>
      <div className="mt-8">
        <BenchRunner />
      </div>
    </main>
  );
}
