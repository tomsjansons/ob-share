"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signIn } from "@/lib/auth-client";
import { Github, Share2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

interface ShareLoginProps {
  sharedData: {
    title: string;
    text: string;
    url: string;
  };
}

export function ShareLogin({ sharedData }: ShareLoginProps) {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    try {
      // Build callback URL with current share params
      const callbackParams = new URLSearchParams();
      if (sharedData.title) callbackParams.set("title", sharedData.title);
      if (sharedData.text) callbackParams.set("text", sharedData.text);
      if (sharedData.url) callbackParams.set("url", sharedData.url);

      const callbackURL =
        "/share" +
        (callbackParams.toString() ? `?${callbackParams.toString()}` : "");

      await signIn.social({
        provider: "github",
        callbackURL,
      });
    } catch (error) {
      console.error("Login failed:", error);
      setIsLoading(false);
    }
  };

  const hasSharedContent =
    sharedData.title || sharedData.text || sharedData.url;
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center">
            <Share2 className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Sign in Required</CardTitle>
          <CardDescription>
            {hasSharedContent
              ? "Please sign in to save the shared content"
              : "Please sign in to use the share feature"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error === "access_denied"
                ? "Access denied. Your GitHub account is not on the allow list."
                : "An error occurred during login. Please try again."}
            </div>
          )}

          {hasSharedContent && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium text-muted-foreground mb-1">
                Content to be shared:
              </p>
              {sharedData.title && (
                <p className="truncate">
                  <span className="font-medium">Title:</span> {sharedData.title}
                </p>
              )}
              {sharedData.text && (
                <p className="truncate">
                  <span className="font-medium">Text:</span> {sharedData.text}
                </p>
              )}
              {sharedData.url && (
                <p className="truncate">
                  <span className="font-medium">URL:</span> {sharedData.url}
                </p>
              )}
            </div>
          )}

          <Button
            onClick={handleGitHubLogin}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            <Github className="mr-2 h-5 w-5" />
            {isLoading ? "Signing in..." : "Sign in with GitHub"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
