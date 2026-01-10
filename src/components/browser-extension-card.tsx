"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Chrome, Download, ExternalLink } from "lucide-react";

export function BrowserExtensionCard() {
  const [showInstructions, setShowInstructions] = useState(false);

  const handleDownload = () => {
    // Trigger the download
    window.location.href = "/api/extension";
    // Show installation instructions
    setShowInstructions(true);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button onClick={handleDownload} className="flex-1">
            <Download className="mr-2 h-4 w-4" />
            Download Extension
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowInstructions(true)}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Features:</strong>
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>One-click sharing from toolbar</li>
            <li>Share with notes via right-click menu</li>
            <li>Share selected text as notes</li>
            <li>Share any link directly</li>
          </ul>
        </div>
      </div>

      {/* Installation Instructions Dialog */}
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Chrome className="h-5 w-5" />
              Install the Extension
            </DialogTitle>
            <DialogDescription>
              Follow these steps to install the ob-share extension
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-2">
            <ol className="list-decimal list-inside space-y-3 text-sm">
              <li>
                <strong>Extract the zip file</strong>
                <p className="text-muted-foreground ml-5 mt-1">
                  Unzip <code className="bg-muted px-1 py-0.5 rounded text-xs">ob-share-extension.zip</code> to a folder
                </p>
              </li>
              <li>
                <strong>Open Extensions page</strong>
                <p className="text-muted-foreground ml-5 mt-1">
                  Go to{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-xs">
                    chrome://extensions
                  </code>{" "}
                  in your browser
                </p>
              </li>
              <li>
                <strong>Enable Developer mode</strong>
                <p className="text-muted-foreground ml-5 mt-1">
                  Toggle the switch in the top-right corner
                </p>
              </li>
              <li>
                <strong>Load the extension</strong>
                <p className="text-muted-foreground ml-5 mt-1">
                  Click &quot;Load unpacked&quot; and select the extracted folder
                </p>
              </li>
            </ol>

            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium mb-1">Using the extension</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                <li>
                  <strong>Click icon</strong> &rarr; Instantly share current page
                </li>
                <li>
                  <strong>Right-click</strong> &rarr; Share with note, share
                  links, share selection
                </li>
                <li>
                  <strong>Settings</strong> &rarr; Configure your ob-share URL
                </li>
              </ul>
            </div>
          </div>

          <div className="flex justify-end px-6 pb-6">
            <Button onClick={() => setShowInstructions(false)}>Got it</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
