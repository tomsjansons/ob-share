"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, AlertTriangle, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AvatarDropdown } from "@/components/avatar-dropdown";
import { AudioPermissionModal } from "@/components/audio-permission-modal";
import { trpc } from "@/lib/trpc/client";
import { isAudioRecordingSupported } from "@/lib/audio";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface DashboardPageProps {
  user: User;
}

export function DashboardPage({ user }: DashboardPageProps) {
  const [showAudioPermissionModal, setShowAudioPermissionModal] = useState(false);
  const router = useRouter();
  const settingsQuery = trpc.settings.get.useQuery();
  const updateAudioPermission = trpc.settings.updateAudioPermission.useMutation({
    onSuccess: () => {
      settingsQuery.refetch();
    },
  });

  const isSettingsComplete = settingsQuery.data?.isComplete ?? false;
  const audioPermission = settingsQuery.data?.audioPermission ?? "not_asked";
  const audioRecordingSupported = isAudioRecordingSupported();

  const handleAudioNoteClick = () => {
    // Check if settings are complete first
    if (!isSettingsComplete) {
      // Show a message or redirect to settings
      router.push("/settings");
      return;
    }

    // Check audio permission status
    if (audioPermission === "not_asked" && audioRecordingSupported) {
      // Show permission modal
      setShowAudioPermissionModal(true);
    } else if (audioPermission === "granted") {
      // Go to audio note page directly
      router.push("/audio-note");
    } else if (audioPermission === "denied") {
      // Permission was denied, show modal again to explain they need to enable it
      setShowAudioPermissionModal(true);
    }
  };

  const handleAudioPermissionClose = async (granted: boolean) => {
    setShowAudioPermissionModal(false);

    // Update permission status in database
    const newStatus = granted ? "granted" : "denied";
    updateAudioPermission.mutate({ audioPermission: newStatus });

    if (granted) {
      // Permission granted, navigate to audio note page
      router.push("/audio-note");
    }
  };

  return (
    <>
      {/* Audio Permission Modal */}
      <AudioPermissionModal
        open={showAudioPermissionModal}
        onClose={handleAudioPermissionClose}
      />

      <div className="relative min-h-screen bg-background">
        {/* Header */}
        <header className="flex items-center justify-between p-4">
          <div className="text-lg font-semibold">ob-share</div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <AvatarDropdown user={user} />
          </div>
        </header>

        {/* Main Content */}
        <main className="flex flex-col items-center justify-center px-4 py-8">
          {/* Incomplete Setup Warning */}
          {!settingsQuery.isLoading && !isSettingsComplete && (
            <div className="w-full max-w-md mb-8">
              <div className="flex flex-col gap-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-4 text-amber-800 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Setup Required</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Configure your vault settings before creating audio notes.
                    </p>
                  </div>
                </div>
                <Link href="/settings">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Configure Vault Settings
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Audio Note Button */}
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center justify-center py-12 px-6">
              <p className="text-lg text-muted-foreground mb-6 text-center">
                Tap to create a new audio note
              </p>

              <Button
                size="lg"
                onClick={handleAudioNoteClick}
                disabled={!audioRecordingSupported}
                className="h-32 w-32 rounded-full shadow-lg"
              >
                <Mic className="h-12 w-12" />
              </Button>

              {!audioRecordingSupported && (
                <p className="text-sm text-muted-foreground mt-4 text-center">
                  Audio recording is not supported in this browser
                </p>
              )}

              {audioRecordingSupported && audioPermission === "denied" && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-4 text-center">
                  Microphone access was denied. Tap to request permission again.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Welcome message */}
          <p className="text-sm text-muted-foreground mt-8 text-center">
            Welcome, {user.name}
          </p>
        </main>
      </div>
    </>
  );
}
