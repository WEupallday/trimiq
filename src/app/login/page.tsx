import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";
import ResetForm from "@/components/ResetForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { token?: string; reset?: string };
}) {
  // /login?token=... -> set a new password (allowed even if a session exists)
  if (searchParams.token) return <ResetForm token={searchParams.token} />;
  // /login?reset=1 -> request a reset link
  if (searchParams.reset) return <ResetForm />;
  // Already logged in? Never show the login form — go to the dashboard.
  const session = await getSession();
  if (session) redirect("/dashboard");
  // default -> normal login
  return <AuthForm mode="login" />;
}
