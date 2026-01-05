"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mic, Loader2, Shield } from "lucide-react";
import { requestAudioPermission } from "@/lib/audio";

interface AudioPermissionModalProps {
  open: boolean;
  onClose: (granted: boolean) => void;
}

export function AudioPermissionModal({
  open,
  onClose,
}: AudioPermissionModalProps) {
  const [isRequesting, setIsRequesting] = useState(false);

  const handleAllow = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestAudioPermission();
      onClose(granted);
    } catch {
      onClose(false);
    } finally {
      setIsRequesting(false);
    }
  };

  const handleDeny = () => {
    onClose(false);
  };

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            Enable Microphone Access
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            ob-share needs access to your microphone to record audio notes.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 space-y-4">
          <div className="rounded-lg bg-muted p-4 space-y-3">
            <p className="text-sm font-medium">Why we need microphone access:</p>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">&#8226;</span>
                <span>
                  Record voice notes directly from the dashboard
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">&#8226;</span>
                <span>
                  Audio recordings are saved to your Obsidian vault
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">&#8226;</span>
                <span>
                  Capture ideas quickly without typing
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Your audio is only used to create notes in your vault. Recordings
              are never sent to external servers.
            </span>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={handleAllow}
            disabled={isRequesting}
            className="w-full"
          >
            {isRequesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Requesting Permission...
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" />
                Allow Microphone Access
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={isRequesting}
            className="w-full"
          >
            Not Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
