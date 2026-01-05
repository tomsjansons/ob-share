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
import { Github } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

export function LandingPage() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    try {
      await signIn.social({
        provider: "github",
        callbackURL: "/account",
      });
    } catch (error) {
      console.error("Login failed:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">ob-share</CardTitle>
          <CardDescription>
            Obsidian vault sharing and synchronization
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
