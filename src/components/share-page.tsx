"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, Share2, ArrowLeft, Image, Music, Video, FileText } from "lucide-react";
import Link from "next/link";
import type { SharedFile } from "@/lib/share-store";

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

export function SharePage({ user, sharedData }: SharePageProps) {
  const hasTextContent =
    sharedData.title || sharedData.text || sharedData.url;
  const hasFiles = sharedData.files && sharedData.files.length > 0;
  const hasSharedContent = hasTextContent || hasFiles;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
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

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                <span>Received as {user.name || user.email}</span>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Share target functionality is set up. Implement your custom
                handling logic here.
              </p>
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
  );
}
