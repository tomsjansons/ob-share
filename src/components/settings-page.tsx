"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Loader2, CheckCircle2, AlertCircle, MapPin, MapPinOff, Mic, MicOff, Clock, Key, RefreshCw, Globe } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { AvatarDropdown } from "@/components/avatar-dropdown";
import { isGeolocationSupported, requestLocationPermission, checkLocationPermission } from "@/lib/location";
import { isAudioRecordingSupported, requestAudioPermission, checkAudioPermission } from "@/lib/audio";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

interface SettingsPageProps {
  user: User;
}

export function SettingsPage({ user }: SettingsPageProps) {
  const [vaultName, setVaultName] = useState("");
  const [incomingFolder, setIncomingFolder] = useState("");
  const [fileCheckInterval, setFileCheckInterval] = useState(10);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-audio-preview");
  const [textLlmProvider, setTextLlmProvider] = useState<"anthropic" | "openai">("anthropic");
  const [textLlmApiKey, setTextLlmApiKey] = useState("");
  const [textLlmModel, setTextLlmModel] = useState("claude-sonnet-4-20250514");
  const [maxRetries, setMaxRetries] = useState(5);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [intervalSaveStatus, setIntervalSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [openaiSaveStatus, setOpenaiSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [textLlmSaveStatus, setTextLlmSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [locationRequesting, setLocationRequesting] = useState(false);
  const [audioRequesting, setAudioRequesting] = useState(false);
  const [browserLocationState, setBrowserLocationState] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [browserAudioState, setBrowserAudioState] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");

  const settingsQuery = trpc.settings.get.useQuery();
  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => {
      setSaveStatus("saved");
      setError(null);
      settingsQuery.refetch();
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
    onError: (err) => {
      setSaveStatus("error");
      setError(err.message);
    },
  });

  const updateLocationPermission = trpc.settings.updateLocationPermission.useMutation({
    onSuccess: () => {
      settingsQuery.refetch();
    },
  });

  const updateAudioPermission = trpc.settings.updateAudioPermission.useMutation({
    onSuccess: () => {
      settingsQuery.refetch();
    },
  });

  const updateFileCheckIntervalMutation = trpc.settings.updateFileCheckInterval.useMutation({
    onSuccess: () => {
      setIntervalSaveStatus("saved");
      settingsQuery.refetch();
      setTimeout(() => setIntervalSaveStatus("idle"), 3000);
    },
    onError: (err) => {
      setIntervalSaveStatus("error");
      setError(err.message);
    },
  });

  const updateOpenaiSettingsMutation = trpc.settings.updateOpenaiSettings.useMutation({
    onSuccess: () => {
      setOpenaiSaveStatus("saved");
      settingsQuery.refetch();
      setTimeout(() => setOpenaiSaveStatus("idle"), 3000);
    },
    onError: (err) => {
      setOpenaiSaveStatus("error");
      setError(err.message);
    },
  });

  const updateTextLlmSettingsMutation = trpc.settings.updateTextLlmSettings.useMutation({
    onSuccess: () => {
      setTextLlmSaveStatus("saved");
      settingsQuery.refetch();
      setTimeout(() => setTextLlmSaveStatus("idle"), 3000);
    },
    onError: (err) => {
      setTextLlmSaveStatus("error");
      setError(err.message);
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setVaultName(settingsQuery.data.vaultName || "");
      setIncomingFolder(settingsQuery.data.incomingFolder || "");
      setFileCheckInterval(settingsQuery.data.fileCheckInterval ?? 10);
      setOpenaiApiKey(settingsQuery.data.openaiApiKey || "");
      setOpenaiModel(settingsQuery.data.openaiModel || "gpt-4o-audio-preview");
      setTextLlmProvider(settingsQuery.data.textLlmProvider || "anthropic");
      setTextLlmApiKey(settingsQuery.data.textLlmApiKey || "");
      setTextLlmModel(settingsQuery.data.textLlmModel || "claude-sonnet-4-20250514");
      setMaxRetries(settingsQuery.data.maxRetries ?? 5);
    }
  }, [settingsQuery.data]);

  // Check browser permission states on mount
  useEffect(() => {
    const checkPermissions = async () => {
      const locationState = await checkLocationPermission();
      setBrowserLocationState(locationState);
      const audioState = await checkAudioPermission();
      setBrowserAudioState(audioState);
    };
    checkPermissions();
  }, []);

  const locationPermission = settingsQuery.data?.locationPermission ?? "not_asked";
  const audioPermission = settingsQuery.data?.audioPermission ?? "not_asked";
  const geolocationSupported = isGeolocationSupported();
  const audioRecordingSupported = isAudioRecordingSupported();

  const handleEnableLocation = async () => {
    setLocationRequesting(true);
    try {
      const granted = await requestLocationPermission();
      updateLocationPermission.mutate({
        locationPermission: granted ? "granted" : "denied",
      });
      // Re-check browser state
      const state = await checkLocationPermission();
      setBrowserLocationState(state);
    } finally {
      setLocationRequesting(false);
    }
  };

  const handleDisableLocation = () => {
    updateLocationPermission.mutate({
      locationPermission: "denied",
    });
  };

  const handleEnableAudio = async () => {
    setAudioRequesting(true);
    try {
      const granted = await requestAudioPermission();
      updateAudioPermission.mutate({
        audioPermission: granted ? "granted" : "denied",
      });
      // Re-check browser state
      const state = await checkAudioPermission();
      setBrowserAudioState(state);
    } finally {
      setAudioRequesting(false);
    }
  };

  const handleDisableAudio = () => {
    updateAudioPermission.mutate({
      audioPermission: "denied",
    });
  };

  const handleSaveFileCheckInterval = () => {
    if (fileCheckInterval < 5 || fileCheckInterval > 3600) {
      setError("File check interval must be between 5 and 3600 seconds");
      setIntervalSaveStatus("error");
      return;
    }

    setIntervalSaveStatus("saving");
    setError(null);
    updateFileCheckIntervalMutation.mutate({
      fileCheckInterval,
    });
  };

  const hasIntervalChanges =
    settingsQuery.data &&
    fileCheckInterval !== (settingsQuery.data.fileCheckInterval ?? 10);

  const handleSaveOpenaiSettings = () => {
    if (maxRetries < 1 || maxRetries > 20) {
      setError("Max retries must be between 1 and 20");
      setOpenaiSaveStatus("error");
      return;
    }

    setOpenaiSaveStatus("saving");
    setError(null);
    updateOpenaiSettingsMutation.mutate({
      openaiApiKey: openaiApiKey || null,
      openaiModel,
      maxRetries,
    });
  };

  const hasOpenaiChanges =
    settingsQuery.data &&
    (openaiApiKey !== (settingsQuery.data.openaiApiKey || "") ||
      openaiModel !== (settingsQuery.data.openaiModel || "gpt-4o-audio-preview") ||
      maxRetries !== (settingsQuery.data.maxRetries ?? 5));

  const handleSaveTextLlmSettings = () => {
    setTextLlmSaveStatus("saving");
    setError(null);
    updateTextLlmSettingsMutation.mutate({
      textLlmProvider,
      textLlmApiKey: textLlmApiKey || null,
      textLlmModel,
    });
  };

  const hasTextLlmChanges =
    settingsQuery.data &&
    (textLlmProvider !== (settingsQuery.data.textLlmProvider || "anthropic") ||
      textLlmApiKey !== (settingsQuery.data.textLlmApiKey || "") ||
      textLlmModel !== (settingsQuery.data.textLlmModel || "claude-sonnet-4-20250514"));

  const handleSave = () => {
    if (!vaultName.trim() || !incomingFolder.trim()) {
      setError("Both fields are required");
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setError(null);
    updateSettings.mutate({
      vaultName: vaultName.trim(),
      incomingFolder: incomingFolder.trim(),
    });
  };

  const hasChanges =
    settingsQuery.data &&
    (vaultName !== (settingsQuery.data.vaultName || "") ||
      incomingFolder !== (settingsQuery.data.incomingFolder || ""));

  if (settingsQuery.isLoading) {
    return (
      <div className="relative min-h-screen bg-background">
        <header className="flex items-center justify-between p-4">
          <Link href="/dashboard" className="text-lg font-semibold hover:text-primary">
            ob-share
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <AvatarDropdown user={user} />
          </div>
        </header>
        <main className="flex flex-col items-center justify-center px-4 py-8">
          <Card className="w-full max-w-md">
            <CardContent className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

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
          <CardHeader>
            <CardTitle className="text-2xl">Settings</CardTitle>
            <CardDescription>
              Configure vault settings and permissions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Vault Configuration Section */}
            <div className="space-y-4">
              <h3 className="font-medium">Vault Configuration</h3>

              {/* Path explanation */}
              <div className="rounded-md bg-muted p-4 text-sm">
                <p className="font-medium mb-2">Destination Path Format</p>
                <code className="text-xs bg-background px-2 py-1 rounded block mb-2">
                  /data/Documents/{"{vault-name}"}/{"{incoming-folder}"}/
                </code>
                <p className="text-muted-foreground text-xs">
                  Files will be saved to this location in your Obsidian vault.
                </p>
              </div>

              {/* Vault Name Field */}
              <div className="space-y-2">
                <Label htmlFor="vaultName">Vault Name</Label>
                <Input
                  id="vaultName"
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  placeholder="my-vault"
                />
                <p className="text-xs text-muted-foreground">
                  The name of your Obsidian vault folder (no leading/trailing slashes).
                  Example: <code className="bg-muted px-1 rounded">my-vault</code>
                </p>
              </div>

              {/* Incoming Folder Field */}
              <div className="space-y-2">
                <Label htmlFor="incomingFolder">Incoming Folder</Label>
                <Input
                  id="incomingFolder"
                  value={incomingFolder}
                  onChange={(e) => setIncomingFolder(e.target.value)}
                  placeholder="incoming"
                />
                <p className="text-xs text-muted-foreground">
                  The folder inside your vault where shared content will be saved (no leading/trailing slashes).
                  Example: <code className="bg-muted px-1 rounded">incoming</code> or{" "}
                  <code className="bg-muted px-1 rounded">inbox/shared</code>
                </p>
              </div>

              {/* Preview */}
              {(vaultName || incomingFolder) && (
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Preview destination:
                  </p>
                  <code className="text-sm break-all">
                    /data/Documents/{vaultName || "{vault-name}"}/
                    {incomingFolder || "{incoming-folder}"}/
                  </code>
                </div>
              )}

              {/* Save Button */}
              <Button
                onClick={handleSave}
                disabled={saveStatus === "saving" || !hasChanges}
                className="w-full"
              >
                {saveStatus === "saving" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Vault Settings
                  </>
                )}
              </Button>

              {/* Status Messages */}
              {saveStatus === "saved" && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-md p-3">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Settings saved successfully</span>
                </div>
              )}

              {saveStatus === "error" && error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Location Permission Section */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Location Sharing</Label>
                  <p className="text-xs text-muted-foreground">
                    Include your location when saving shared content
                  </p>
                </div>
                {locationPermission === "granted" && (
                  <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 px-2 py-1 rounded">
                    <MapPin className="h-3 w-3" />
                    <span>Enabled</span>
                  </div>
                )}
                {locationPermission === "denied" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <MapPinOff className="h-3 w-3" />
                    <span>Disabled</span>
                  </div>
                )}
                {locationPermission === "not_asked" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <MapPin className="h-3 w-3" />
                    <span>Not Set</span>
                  </div>
                )}
              </div>

              {!geolocationSupported ? (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <p>Location sharing is not supported in this browser.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {locationPermission === "granted" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Your notes will include location data (country, city, area, street) when available.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisableLocation}
                        className="w-full"
                      >
                        <MapPinOff className="mr-2 h-4 w-4" />
                        Disable Location Sharing
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Enable location sharing to include where you were when you shared content.
                        This helps provide context for your notes.
                      </p>
                      {browserLocationState === "denied" && (
                        <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-2 text-xs text-amber-800 dark:text-amber-200">
                          <p>
                            Location access was denied in your browser. To enable it, you&apos;ll need to
                            allow location access in your browser settings for this site.
                          </p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEnableLocation}
                        disabled={locationRequesting}
                        className="w-full"
                      >
                        {locationRequesting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Requesting Permission...
                          </>
                        ) : (
                          <>
                            <MapPin className="mr-2 h-4 w-4" />
                            Enable Location Sharing
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Audio Permission Section */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Audio Recording</Label>
                  <p className="text-xs text-muted-foreground">
                    Record audio notes directly from the dashboard
                  </p>
                </div>
                {audioPermission === "granted" && (
                  <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 px-2 py-1 rounded">
                    <Mic className="h-3 w-3" />
                    <span>Enabled</span>
                  </div>
                )}
                {audioPermission === "denied" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <MicOff className="h-3 w-3" />
                    <span>Disabled</span>
                  </div>
                )}
                {audioPermission === "not_asked" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    <Mic className="h-3 w-3" />
                    <span>Not Set</span>
                  </div>
                )}
              </div>

              {!audioRecordingSupported ? (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <p>Audio recording is not supported in this browser.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {audioPermission === "granted" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        You can record audio notes from the dashboard. Recordings are saved to your Obsidian vault.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisableAudio}
                        className="w-full"
                      >
                        <MicOff className="mr-2 h-4 w-4" />
                        Disable Audio Recording
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Enable audio recording to capture voice notes directly from the dashboard.
                        Audio notes are saved as files in your Obsidian vault.
                      </p>
                      {browserAudioState === "denied" && (
                        <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-2 text-xs text-amber-800 dark:text-amber-200">
                          <p>
                            Microphone access was denied in your browser. To enable it, you&apos;ll need to
                            allow microphone access in your browser settings for this site.
                          </p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEnableAudio}
                        disabled={audioRequesting}
                        className="w-full"
                      >
                        {audioRequesting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Requesting Permission...
                          </>
                        ) : (
                          <>
                            <Mic className="mr-2 h-4 w-4" />
                            Enable Audio Recording
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* File Check Interval Section */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">File Check Interval</Label>
                  <p className="text-xs text-muted-foreground">
                    How often to check for new files in the incoming folder (seconds)
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                  <Clock className="h-3 w-3" />
                  <span>{settingsQuery.data?.fileCheckInterval ?? 10}s</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={3600}
                    value={fileCheckInterval}
                    onChange={(e) => setFileCheckInterval(parseInt(e.target.value) || 10)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSaveFileCheckInterval}
                    disabled={intervalSaveStatus === "saving" || !hasIntervalChanges}
                    size="sm"
                  >
                    {intervalSaveStatus === "saving" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The system will check the incoming folder every {fileCheckInterval} seconds for new notes to process.
                  Minimum: 5 seconds, Maximum: 3600 seconds (1 hour).
                </p>

                {intervalSaveStatus === "saved" && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-md p-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Interval saved</span>
                  </div>
                )}
              </div>
            </div>

            {/* OpenAI Settings Section */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-muted-foreground" />
                <Label className="text-base font-medium">AI Extraction Settings</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Configure OpenAI API for audio transcription and content extraction.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openai-api-key">OpenAI API Key</Label>
                  <Input
                    id="openai-api-key"
                    type="password"
                    placeholder="sk-..."
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for audio transcription. Get your key from{" "}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      OpenAI Platform
                    </a>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="openai-model">Transcription Model</Label>
                  <Input
                    id="openai-model"
                    type="text"
                    placeholder="gpt-4o-audio-preview"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Model used for audio processing. Default: gpt-4o-audio-preview (uses whisper-1 for transcription)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    <Label htmlFor="max-retries">Max Retry Attempts</Label>
                  </div>
                  <Input
                    id="max-retries"
                    type="number"
                    min={1}
                    max={20}
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(parseInt(e.target.value) || 5)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of times to retry failed extractions with exponential backoff (1-20)
                  </p>
                </div>

                <Button
                  onClick={handleSaveOpenaiSettings}
                  disabled={openaiSaveStatus === "saving" || !hasOpenaiChanges}
                  className="w-full"
                >
                  {openaiSaveStatus === "saving" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save AI Settings
                    </>
                  )}
                </Button>

                {openaiSaveStatus === "saved" && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-md p-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>AI settings saved</span>
                  </div>
                )}
              </div>
            </div>

            {/* Text LLM Settings Section */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <Label className="text-base font-medium">URL Summarization Settings</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Configure the LLM provider for URL content extraction and summarization.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="text-llm-provider">LLM Provider</Label>
                  <select
                    id="text-llm-provider"
                    value={textLlmProvider}
                    onChange={(e) => {
                      const provider = e.target.value as "anthropic" | "openai";
                      setTextLlmProvider(provider);
                      // Set default model when provider changes
                      if (provider === "anthropic") {
                        setTextLlmModel("claude-sonnet-4-20250514");
                      } else {
                        setTextLlmModel("gpt-4o");
                      }
                    }}
                    className="w-full h-10 px-3 py-2 text-sm border rounded-md bg-background"
                  >
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI (GPT)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Choose which AI provider to use for URL content summarization
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="text-llm-api-key">
                    {textLlmProvider === "anthropic" ? "Anthropic API Key" : "OpenAI API Key"}
                  </Label>
                  <Input
                    id="text-llm-api-key"
                    type="password"
                    placeholder={textLlmProvider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    value={textLlmApiKey}
                    onChange={(e) => setTextLlmApiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for URL summarization. Get your key from{" "}
                    {textLlmProvider === "anthropic" ? (
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Anthropic Console
                      </a>
                    ) : (
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        OpenAI Platform
                      </a>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="text-llm-model">Model</Label>
                  <Input
                    id="text-llm-model"
                    type="text"
                    placeholder={textLlmProvider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o"}
                    value={textLlmModel}
                    onChange={(e) => setTextLlmModel(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {textLlmProvider === "anthropic"
                      ? "Default: claude-sonnet-4-20250514. Other options: claude-opus-4-20250514, claude-3-5-haiku-20241022"
                      : "Default: gpt-4o. Other options: gpt-4o-mini, gpt-4-turbo"}
                  </p>
                </div>

                <Button
                  onClick={handleSaveTextLlmSettings}
                  disabled={textLlmSaveStatus === "saving" || !hasTextLlmChanges}
                  className="w-full"
                >
                  {textLlmSaveStatus === "saving" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save URL Settings
                    </>
                  )}
                </Button>

                {textLlmSaveStatus === "saved" && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-md p-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>URL settings saved</span>
                  </div>
                )}

                {textLlmSaveStatus === "error" && error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Back Link */}
            <Link href="/dashboard" className="block pt-4">
              <Button variant="outline" className="w-full">
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
