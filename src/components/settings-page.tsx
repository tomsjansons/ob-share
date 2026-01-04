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
import { ArrowLeft, Save, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ThemeToggle } from "@/components/theme-toggle";

export function SettingsPage() {
  const [vaultName, setVaultName] = useState("");
  const [incomingFolder, setIncomingFolder] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (settingsQuery.data) {
      setVaultName(settingsQuery.data.vaultName || "");
      setIncomingFolder(settingsQuery.data.incomingFolder || "");
    }
  }, [settingsQuery.data]);

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
      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Vault Settings</CardTitle>
          <CardDescription>
            Configure where shared content is saved in your Obsidian vault
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                Save Settings
              </>
            )}
          </Button>

          {/* Back Link */}
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
