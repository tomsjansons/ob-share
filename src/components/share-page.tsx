"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, Share2, ArrowLeft, Image, Music, Video, FileText, Loader2, CheckCircle2, XCircle, AlertTriangle, Settings, MapPin } from "lucide-react";
import Link from "next/link";
import type { SharedFile } from "@/lib/share-store";
import { trpc } from "@/lib/trpc/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocationPermissionModal } from "@/components/location-permission-modal";
import { getLocation, isGeolocationSupported } from "@/lib/location";
import type { LocationInfo } from "@/lib/vault";

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
    files: SharedFile[];
    error?: string;
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return Image;
  if (type.startsWith("audio/")) return Music;
  if (type.startsWith("video/")) return Video;
  return FileText;
}

function FilePreview({ file }: { file: SharedFile }) {
  if (file.type.startsWith("image/")) {
    return (
      <div className="space-y-2">
        <img
          src={file.dataUrl}
          alt={file.name}
          className="max-w-full max-h-64 rounded-md object-contain mx-auto"
        />
        <p className="text-xs text-muted-foreground text-center">
          {file.name} ({formatFileSize(file.size)})
        </p>
      </div>
    );
  }

  if (file.type.startsWith("audio/")) {
    return (
      <div className="space-y-2">
        <audio controls className="w-full">
          <source src={file.dataUrl} type={file.type} />
          Your browser does not support the audio element.
        </audio>
        <p className="text-xs text-muted-foreground text-center">
          {file.name} ({formatFileSize(file.size)})
        </p>
      </div>
    );
  }

  if (file.type.startsWith("video/")) {
    return (
      <div className="space-y-2">
        <video controls className="max-w-full max-h-64 rounded-md mx-auto">
          <source src={file.dataUrl} type={file.type} />
          Your browser does not support the video element.
        </video>
        <p className="text-xs text-muted-foreground text-center">
          {file.name} ({formatFileSize(file.size)})
        </p>
      </div>
    );
  }

  // Generic file display
  const Icon = getFileIcon(file.type);
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {file.type} - {formatFileSize(file.size)}
        </p>
      </div>
    </div>
  );
}

type SaveStatus = "idle" | "waiting_location" | "getting_location" | "saving" | "saved" | "error";

export function SharePage({ user, sharedData }: SharePageProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locationInfo, setLocationInfo] = useState<LocationInfo | undefined>(undefined);
  const saveInitiated = useRef(false);

  const settingsQuery = trpc.settings.get.useQuery();
  const isSettingsComplete = settingsQuery.data?.isComplete ?? false;
  const locationPermission = settingsQuery.data?.locationPermission ?? "not_asked";

  const updateLocationPermission = trpc.settings.updateLocationPermission.useMutation();

  const saveToVault = trpc.vault.saveSharedContent.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setSaveStatus("saved");
        setSavedPath(result.notePath || null);
      } else {
        setSaveStatus("error");
        setSaveError(result.error || "Failed to save to vault");
      }
    },
    onError: (error) => {
      setSaveStatus("error");
      setSaveError(error.message);
    },
  });

  const hasTextContent =
    sharedData.title || sharedData.text || sharedData.url;
  const hasFiles = sharedData.files && sharedData.files.length > 0;
  const hasSharedContent = hasTextContent || hasFiles;

  // Function to perform the actual save
  const performSave = useCallback((location: LocationInfo | undefined) => {
    setSaveStatus("saving");
    saveToVault.mutate({
      title: sharedData.title || undefined,
      text: sharedData.text || undefined,
      url: sharedData.url || undefined,
      files: sharedData.files?.map((f) => ({
        name: f.name,
        type: f.type,
        dataUrl: f.dataUrl,
      })),
      location,
    });
  }, [sharedData, saveToVault]);

  // Function to get location and then save
  const getLocationAndSave = useCallback(async () => {
    setSaveStatus("getting_location");

    if (!isGeolocationSupported()) {
      // No geolocation support, save without location
      performSave(undefined);
      return;
    }

    const result = await getLocation();

    if (result.success && result.location) {
      setLocationInfo(result.location);
      performSave(result.location);
    } else {
      // Location failed, save without location
      performSave(undefined);
    }
  }, [performSave]);

  // Handle location modal close
  const handleLocationModalClose = useCallback(async (granted: boolean) => {
    setShowLocationModal(false);

    // Update permission status in database
    const newStatus = granted ? "granted" : "denied";
    updateLocationPermission.mutate({ locationPermission: newStatus });

    if (granted) {
      // User granted permission, get location and save
      await getLocationAndSave();
    } else {
      // User denied, save without location
      performSave(undefined);
    }
  }, [updateLocationPermission, getLocationAndSave, performSave]);

  // Automatically save to vault when content is received and settings are complete
  useEffect(() => {
    if (!hasSharedContent || saveStatus !== "idle" || !isSettingsComplete || settingsQuery.isLoading) {
      return;
    }

    // Prevent double execution
    if (saveInitiated.current) {
      return;
    }
    saveInitiated.current = true;

    // Check location permission status
    if (locationPermission === "not_asked" && isGeolocationSupported()) {
      // Show location permission modal
      setSaveStatus("waiting_location");
      setShowLocationModal(true);
    } else if (locationPermission === "granted") {
      // Permission already granted, get location and save
      getLocationAndSave();
    } else {
      // Permission denied or not supported, save without location
      setSaveStatus("saving");
      performSave(undefined);
    }
  }, [hasSharedContent, saveStatus, isSettingsComplete, settingsQuery.isLoading, locationPermission, getLocationAndSave, performSave]);

  return (
    <>
      {/* Location Permission Modal */}
      <LocationPermissionModal
        open={showLocationModal}
        onClose={handleLocationModalClose}
      />

      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
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
          {/* Incomplete Setup Warning */}
          {!settingsQuery.isLoading && !isSettingsComplete && (
            <div className="flex flex-col gap-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-4 text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Incomplete Setup</p>
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Vault settings must be configured before content can be saved.
                  </p>
                </div>
              </div>
              <Link href="/settings">
                <Button size="sm" variant="outline" className="w-full border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure Vault Settings
                </Button>
              </Link>
            </div>
          )}

          {sharedData.error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {sharedData.error === "processing"
                ? "An error occurred while processing the shared content."
                : `Error: ${sharedData.error}`}
            </div>
          )}

          {hasSharedContent ? (
            <>
              {/* Text content section */}
              {hasTextContent && (
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
              )}

              {/* Files section */}
              {hasFiles && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Files ({sharedData.files.length})
                  </p>
                  <div className="space-y-3">
                    {sharedData.files.map((file, index) => (
                      <div key={index} className="rounded-md bg-muted p-3">
                        <FilePreview file={file} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save status indicator */}
              <div className="rounded-md bg-muted/50 p-3">
                {(saveStatus === "waiting_location") && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>Waiting for location permission...</span>
                  </div>
                )}
                {saveStatus === "getting_location" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Getting your location...</span>
                  </div>
                )}
                {saveStatus === "saving" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Saving to vault...</span>
                  </div>
                )}
                {saveStatus === "saved" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Saved to Obsidian vault</span>
                    </div>
                    {savedPath && (
                      <p className="text-xs text-center text-muted-foreground">
                        {savedPath}
                      </p>
                    )}
                    {locationInfo && (
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {[locationInfo.city, locationInfo.country].filter(Boolean).join(", ") || "Location saved"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {saveStatus === "error" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                      <XCircle className="h-4 w-4" />
                      <span>Failed to save to vault</span>
                    </div>
                    {saveError && (
                      <p className="text-xs text-center text-muted-foreground">
                        {saveError}
                      </p>
                    )}
                  </div>
                )}
                {saveStatus === "idle" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 text-green-500 dark:text-green-400" />
                    <span>Received as {user.name || user.email}</span>
                  </div>
                )}
              </div>
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
    </>
  );
}
