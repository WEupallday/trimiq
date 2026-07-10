import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";

// Always check the live session so an already-authenticated user can never be
// shown the signup page (they get sent straight to their dashboard instead).
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
