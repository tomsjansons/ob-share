"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth-client";
import { LogOut, Settings, AlertTriangle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { AvatarDropdown } from "@/components/avatar-dropdown";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface AccountPageProps {
  user: User;
}

export function AccountPage({ user }: AccountPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const settingsQuery = trpc.settings.get.useQuery();

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push("/");
          },
        },
      });
    } catch (error) {
      console.error("Sign out failed:", error);
      setIsLoading(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="relative min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between p-4">
        <Link href="/dashboard" className="text-lg font-semibold hover:text-primary">
          ob-share
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <AvatarDropdown user={user} />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={user.image || undefined} alt={user.name} />
                <AvatarFallback className="text-lg">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-2xl">{user.name}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Incomplete Setup Warning */}
            {settingsQuery.data && !settingsQuery.data.isComplete && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Incomplete Setup</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Configure your vault settings to enable sharing.
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-md border p-4 space-y-2">
              <div className="text-sm text-muted-foreground">Account Details</div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User ID</span>
                  <span className="font-mono text-xs">{user.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span>{user.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{user.email}</span>
                </div>
              </div>
            </div>

            {/* Settings Link */}
            <Link href="/settings" className="block">
              <Button variant="outline" className="w-full">
                <Settings className="mr-2 h-4 w-4" />
                Vault Settings
                {settingsQuery.data && !settingsQuery.data.isComplete && (
                  <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(Required)</span>
                )}
              </Button>
            </Link>

            <Button
              onClick={handleSignOut}
              disabled={isLoading}
              variant="outline"
              className="w-full"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {isLoading ? "Signing out..." : "Sign out"}
            </Button>

            {/* Back to Dashboard Link */}
            <Link href="/dashboard" className="block">
              <Button variant="ghost" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
