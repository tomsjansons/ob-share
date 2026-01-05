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
import { MapPin, Loader2, Shield } from "lucide-react";
import { requestLocationPermission } from "@/lib/location";

interface LocationPermissionModalProps {
  open: boolean;
  onClose: (granted: boolean) => void;
}

export function LocationPermissionModal({
  open,
  onClose,
}: LocationPermissionModalProps) {
  const [isRequesting, setIsRequesting] = useState(false);

  const handleAllow = async () => {
    setIsRequesting(true);
    try {
      const granted = await requestLocationPermission();
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
            <MapPin className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            Enable Location Sharing
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            ob-share would like to access your location to include it with your
            shared content.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 space-y-4">
          <div className="rounded-lg bg-muted p-4 space-y-3">
            <p className="text-sm font-medium">Why we need your location:</p>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>
                  Your notes will include where you were when you shared them
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>
                  This helps you remember the context of captured content later
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>
                  Location includes: country, city, area, and street when available
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Your location is only used when saving notes and is never sent to
              external servers beyond what&apos;s needed for address lookup.
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
                <MapPin className="mr-2 h-4 w-4" />
                Allow Location Access
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
