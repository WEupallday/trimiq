import AuthForm from "@/components/AuthForm";
import ResetForm from "@/components/ResetForm";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { token?: string; reset?: string };
}) {
  // /login?token=... -> set a new password
  if (searchParams.token) return <ResetForm token={searchParams.token} />;
  // /login?reset=1 -> request a reset link
  if (searchParams.reset) return <ResetForm />;
  // default -> normal login
  return <AuthForm mode="login" />;
}
