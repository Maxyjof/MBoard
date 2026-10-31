import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginScreen } from "./login-screen";

export const metadata = {
  title: "登录",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/boards");

  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith("/") ? params.next : "/boards";

  return <LoginScreen nextPath={nextPath} appName={process.env.APP_NAME || "MBoard"} />;
}
