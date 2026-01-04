import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SettingsPage } from "@/components/settings-page";

export default async function Settings() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/");
  }

  return <SettingsPage />;
}
