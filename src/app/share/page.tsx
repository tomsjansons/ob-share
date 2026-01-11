import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SharePage } from "@/components/share-page";
import { ShareLogin } from "@/components/share-login";
import { getSharedData, SharedFile, CapturedPageData } from "@/lib/share-store";

interface SharePageProps {
  searchParams: Promise<{
    id?: string;
    title?: string;
    text?: string;
    url?: string;
    error?: string;
  }>;
}

export interface SharedDataWithFiles {
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
  error?: string;
  capturedContent?: CapturedPageData;
}

export default async function Share({ searchParams }: SharePageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const params = await searchParams;

  // Try to get stored data by ID first (for file shares and captured content)
  let sharedData: SharedDataWithFiles;
  if (params.id) {
    const storedData = getSharedData(params.id);
    if (storedData) {
      sharedData = {
        title: storedData.title,
        text: storedData.text,
        url: storedData.url,
        files: storedData.files,
        capturedContent: storedData.capturedContent,
      };
    } else {
      // Data expired or not found, fall back to URL params
      sharedData = {
        title: params.title || "",
        text: params.text || "",
        url: params.url || "",
        files: [],
      };
    }
  } else {
    // Legacy GET request or direct navigation
    sharedData = {
      title: params.title || "",
      text: params.text || "",
      url: params.url || "",
      files: [],
    };
  }

  if (params.error) {
    sharedData.error = params.error;
  }

  if (!session?.user) {
    return <ShareLogin sharedData={sharedData} />;
  }

  return <SharePage user={session.user} sharedData={sharedData} />;
}
