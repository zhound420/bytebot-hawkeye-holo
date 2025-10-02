"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface CVMethodActivity {
  method: string;
  active: boolean;
  startTime?: number;
  duration?: number;
}

interface CVActivitySnapshot {
  activeMethods: string[];
  totalActiveCount: number;
  methodDetails: Record<string, CVMethodActivity>;
  performance: {
    averageProcessingTime: number;
    totalMethodsExecuted: number;
    successRate: number;
  };
  omniparserDevice?: string;
}

const methodDisplayNames: Record<string, string> = {
  "template-matching": "Template Match",
  "feature-matching": "Feature Match",
  "contour-detection": "Contour Detect",
  "ocr-detection": "OCR",
  "omniparser": "OmniParser AI",
};

const methodColors: Record<string, string> = {
  "template-matching": "bg-blue-500",
  "feature-matching": "bg-purple-500",
  "contour-detection": "bg-green-500",
  "ocr-detection": "bg-yellow-500",
  "omniparser": "bg-pink-500",
};

// Helper function to get device badge and styling
const getDeviceBadge = (device?: string): { icon: string; label: string; color: string } => {
  if (!device) return { icon: "💻", label: "Local", color: "text-blue-500" };

  const deviceLower = device.toLowerCase();
  if (deviceLower.includes("cuda")) {
    return { icon: "⚡", label: "GPU", color: "text-green-500" };
  } else if (deviceLower.includes("mps")) {
    return { icon: "⚡", label: "GPU", color: "text-green-500" };
  } else if (deviceLower.includes("cpu")) {
    return { icon: "💻", label: "CPU", color: "text-blue-500" };
  }
  return { icon: "💻", label: "Local", color: "text-blue-500" };
};

interface CVActivityIndicatorProps {
  className?: string;
  compact?: boolean;
}

export function CVActivityIndicator({ className, compact = false }: CVActivityIndicatorProps) {
  const [activity, setActivity] = useState<CVActivitySnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchActivity = async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BYTEBOT_AGENT_BASE_URL || "http://localhost:9991";
        const response = await fetch(`${baseUrl}/cv-activity/stream`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (mounted) {
          setActivity(data);
        }
      } catch (error) {
        console.debug("CV activity fetch failed:", error);
      }
    };

    // Initial fetch
    fetchActivity();

    // Poll every 500ms for real-time updates
    const intervalId = setInterval(fetchActivity, 500);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  if (!activity || activity.totalActiveCount === 0) {
    return null; // Don't show when inactive
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-1">
          {activity.activeMethods.map((method) => (
            <div
              key={method}
              className={cn(
                "h-2 w-2 rounded-full animate-pulse",
                methodColors[method] || "bg-gray-500"
              )}
              title={methodDisplayNames[method] || method}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          CV Active
        </span>
      </div>
    );
  }

  const deviceBadge = getDeviceBadge(activity.omniparserDevice);
  const hasOmniParser = activity.activeMethods.includes("omniparser") || activity.omniparserDevice;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            CV Detection Active
          </h3>
          {hasOmniParser && (
            <span className={cn("text-xs font-medium flex items-center gap-1", deviceBadge.color)}>
              <span>{deviceBadge.icon}</span>
              <span>Local Processing</span>
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {activity.totalActiveCount} {activity.totalActiveCount === 1 ? "method" : "methods"}
        </span>
      </div>

      <div className="space-y-2">
        {activity.activeMethods.map((method) => {
          const detail = activity.methodDetails[method];
          const displayName = methodDisplayNames[method] || method;
          const color = methodColors[method] || "bg-gray-500";
          const isOmniParser = method === "omniparser";

          return (
            <div key={method} className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full animate-pulse", color)} />
              <span className="text-sm font-medium">{displayName}</span>
              {isOmniParser && activity.omniparserDevice && (
                <span className={cn("text-xs font-medium", deviceBadge.color)}>
                  {deviceBadge.icon} {deviceBadge.label}
                </span>
              )}
              {detail?.startTime && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {Math.round((Date.now() - detail.startTime) / 100) / 10}s
                </span>
              )}
            </div>
          );
        })}
      </div>

      {activity.performance.totalMethodsExecuted > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Avg Time</div>
              <div className="font-medium">
                {Math.round(activity.performance.averageProcessingTime)}ms
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total</div>
              <div className="font-medium">
                {activity.performance.totalMethodsExecuted}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Success</div>
              <div className="font-medium">
                {Math.round(activity.performance.successRate * 100)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Compute</div>
              <div className={cn("font-medium", hasOmniParser ? deviceBadge.color : "")}>
                {hasOmniParser ? `${deviceBadge.icon} ${deviceBadge.label}` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
