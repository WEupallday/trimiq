import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { requireAdmin, adminData } from "@/lib/admin";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const data = await adminData();

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo size={32} />
            TrimIQ <span className="text-sm font-normal text-white/40">Admin</span>
          </Link>
          <Link href="/dashboard" className="text-sm text-white/60 transition hover:text-white">
            ← Dashboard
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <AdminDashboard data={data} />
      </section>
    </main>
  );
}
