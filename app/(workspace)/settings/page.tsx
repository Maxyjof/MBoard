import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getEffectiveProfile } from "@/lib/auth/profile";
import { AccountSettings } from "@/components/account/account-settings";

export const metadata = {
  title: "账号设置",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await getEffectiveProfile(session.username);
  if (!user) redirect("/login");

  return <AccountSettings user={user} />;
}
