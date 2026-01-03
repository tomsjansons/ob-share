import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SharePage } from "@/components/share-page";
import { ShareLogin } from "@/components/share-login";

interface SharePageProps {
  searchParams: Promise<{
    title?: string;
    text?: string;
    url?: string;
  }>;
}

export default async function Share({ searchParams }: SharePageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const params = await searchParams;
  const sharedData = {
    title: params.title || "",
    text: params.text || "",
    url: params.url || "",
  };

  if (!session?.user) {
    return <ShareLogin sharedData={sharedData} />;
  }

  return <SharePage user={session.user} sharedData={sharedData} />;
}
