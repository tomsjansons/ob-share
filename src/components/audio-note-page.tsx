"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Mic,
  Square,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  MapPin,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AvatarDropdown } from "@/components/avatar-dropdown";
import { AudioRecorder, getAudioExtension } from "@/lib/audio";
import { trpc } from "@/lib/trpc/client";
import { getLocation, isGeolocationSupported } from "@/lib/location";
import type { LocationInfo } from "@/lib/vault";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface AudioNotePageProps {
  user: User;
}

type RecordingState =
  | "initializing"
  | "recording"
  | "stopping"
  | "getting_location"
  | "saving"
  | "saved"
  | "error"
  | "cancelled";

export function AudioNotePage({ user }: AudioNotePageProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>("initializing");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [locationInfo, setLocationInfo] = useState<LocationInfo | undefined>(undefined);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const router = useRouter();

  const settingsQuery = trpc.settings.get.useQuery();
  const locationPermission = settingsQuery.data?.locationPermission ?? "not_asked";

  const saveToVault = trpc.vault.saveSharedContent.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setRecordingState("saved");
        setSavedPath(result.notePath || null);
      } else {
        setRecordingState("error");
        setError(result.error || "Failed to save to vault");
      }
    },
    onError: (err) => {
      setRecordingState("error");
      setError(err.message);
    },
  });

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Start recording when component mounts
  useEffect(() => {
    const startRecording = async () => {
      recorderRef.current = new AudioRecorder();
      const result = await recorderRef.current.start();

      if (result.success) {
        setRecordingState("recording");
        // Start duration timer
        durationIntervalRef.current = window.setInterval(() => {
          if (recorderRef.current) {
            setDuration(recorderRef.current.getDuration());
          }
        }, 100);
      } else {
        setRecordingState("error");
        setError(result.error || "Failed to start recording");
      }
    };

    startRecording();

    // Cleanup on unmount
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (recorderRef.current) {
        recorderRef.current.cancel();
      }
    };
  }, []);

  // Save the audio to vault
  const saveAudio = useCallback(
    async (dataUrl: string, mimeType: string, location?: LocationInfo) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const extension = getAudioExtension(mimeType);
      const fileName = `audio-note-${timestamp}.${extension}`;

      setRecordingState("saving");
      saveToVault.mutate({
        title: `Audio Note - ${new Date().toLocaleString()}`,
        files: [
          {
            name: fileName,
            type: mimeType,
            dataUrl,
          },
        ],
        location,
      });
    },
    [saveToVault]
  );

  // Handle stop recording
  const handleStop = async () => {
    if (!recorderRef.current || recordingState !== "recording") {
      return;
    }

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setRecordingState("stopping");

    // Stop recording
    const result = await recorderRef.current.stop();

    if (!result.success || !result.dataUrl) {
      setRecordingState("error");
      setError(result.error || "Failed to stop recording");
      return;
    }

    const { dataUrl } = result;
    const mimeType = result.blob?.type || "audio/webm";

    // Get location if permission is granted
    if (locationPermission === "granted" && isGeolocationSupported()) {
      setRecordingState("getting_location");
      const locationResult = await getLocation();
      if (locationResult.success && locationResult.location) {
        setLocationInfo(locationResult.location);
        await saveAudio(dataUrl, mimeType, locationResult.location);
      } else {
        // Failed to get location, save without it
        await saveAudio(dataUrl, mimeType, undefined);
      }
    } else {
      // Save without location
      await saveAudio(dataUrl, mimeType, undefined);
    }
  };

  // Handle cancel recording
  const handleCancel = () => {
    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Cancel recording
    if (recorderRef.current) {
      recorderRef.current.cancel();
    }

    setRecordingState("cancelled");
    router.push("/dashboard");
  };

  // Handle return to dashboard
  const handleDone = () => {
    router.push("/dashboard");
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
          <CardContent className="flex flex-col items-center justify-center py-12 px-6">
            {/* Recording State */}
            {recordingState === "initializing" && (
              <>
                <Loader2 className="h-16 w-16 animate-spin text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  Starting recording...
                </p>
              </>
            )}

            {recordingState === "recording" && (
              <>
                {/* Recording indicator */}
                <div className="relative mb-6">
                  <div className="h-32 w-32 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
                    <div className="h-24 w-24 rounded-full bg-red-500/40 flex items-center justify-center">
                      <Mic className="h-12 w-12 text-red-500" />
                    </div>
                  </div>
                  <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 animate-pulse" />
                </div>

                {/* Duration */}
                <p className="text-3xl font-mono font-bold mb-2">
                  {formatDuration(duration)}
                </p>
                <p className="text-muted-foreground mb-8">Recording...</p>

                {/* Control buttons */}
                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleCancel}
                    className="h-14 px-6"
                  >
                    <X className="mr-2 h-5 w-5" />
                    Cancel
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleStop}
                    className="h-14 px-6 bg-red-500 hover:bg-red-600"
                  >
                    <Square className="mr-2 h-5 w-5" />
                    Stop & Save
                  </Button>
                </div>
              </>
            )}

            {recordingState === "stopping" && (
              <>
                <Loader2 className="h-16 w-16 animate-spin text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  Processing recording...
                </p>
              </>
            )}

            {recordingState === "getting_location" && (
              <>
                <Loader2 className="h-16 w-16 animate-spin text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  Getting your location...
                </p>
              </>
            )}

            {recordingState === "saving" && (
              <>
                <Loader2 className="h-16 w-16 animate-spin text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  Saving to vault...
                </p>
              </>
            )}

            {recordingState === "saved" && (
              <>
                <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                </div>
                <p className="text-lg font-medium text-green-600 dark:text-green-400 mb-2">
                  Audio Note Saved
                </p>
                {savedPath && (
                  <p className="text-sm text-muted-foreground mb-2 text-center break-all">
                    {savedPath}
                  </p>
                )}
                {locationInfo && (
                  <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-4">
                    <MapPin className="h-3 w-3" />
                    <span>
                      {[locationInfo.city, locationInfo.country]
                        .filter(Boolean)
                        .join(", ") || "Location saved"}
                    </span>
                  </div>
                )}
                <p className="text-sm text-muted-foreground mb-6 text-center">
                  Duration: {formatDuration(duration)}
                </p>
                <Button onClick={handleDone} className="w-full">
                  Done
                </Button>
              </>
            )}

            {recordingState === "error" && (
              <>
                <div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                  <XCircle className="h-10 w-10 text-red-500" />
                </div>
                <p className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
                  Recording Failed
                </p>
                {error && (
                  <p className="text-sm text-muted-foreground mb-6 text-center">
                    {error}
                  </p>
                )}
                <div className="flex gap-4">
                  <Button variant="outline" onClick={handleDone}>
                    Back to Dashboard
                  </Button>
                  <Button onClick={() => window.location.reload()}>
                    Try Again
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
