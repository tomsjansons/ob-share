"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, Share2, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface SharePageProps {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  sharedData: {
    title: string;
    text: string;
    url: string;
  };
}

export function SharePage({ user, sharedData }: SharePageProps) {
  const hasSharedContent =
    sharedData.title || sharedData.text || sharedData.url;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center">
            <Share2 className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {hasSharedContent ? "Content Received" : "Share to ob-share"}
          </CardTitle>
          <CardDescription>
            {hasSharedContent
              ? "The following content was shared with ob-share"
              : "No content was shared"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasSharedContent ? (
            <>
              <div className="rounded-md bg-muted p-4 space-y-2">
                {sharedData.title && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Title
                    </p>
                    <p className="text-sm break-words">{sharedData.title}</p>
                  </div>
                )}
                {sharedData.text && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Text
                    </p>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {sharedData.text}
                    </p>
                  </div>
                )}
                {sharedData.url && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      URL
                    </p>
                    <a
                      href={sharedData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {sharedData.url}
                    </a>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                <span>Received as {user.name || user.email}</span>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Share target functionality is set up. Implement your custom
                handling logic here.
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Share content from other apps to see it here.
            </p>
          )}

          <Link href="/account" className="block">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Account
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
