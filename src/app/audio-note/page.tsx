import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AudioNotePage } from "@/components/audio-note-page";

export default async function AudioNote() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/");
  }

  return <AudioNotePage user={session.user} />;
}
