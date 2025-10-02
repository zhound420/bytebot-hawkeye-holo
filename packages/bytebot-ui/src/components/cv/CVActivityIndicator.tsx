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
  omniparserModels?: {
    iconDetector: string;
    captionModel: string;
  };
}

const methodDisplayNames: Record<string, string> = {
  "template-matching": "Template Match",
  "feature-matching": "Feature Match",
  "contour-detection": "Contour Detect",
  "ocr-detection": "OCR",
  "omniparser": "OmniParser",
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

  // Show if: active methods OR recent history OR device info available
  const hasRecentActivity = (activity?.performance?.totalMethodsExecuted ?? 0) > 0;
  const hasDeviceInfo = activity?.omniparserDevice !== undefined;
  const shouldShow = activity && (activity.totalActiveCount > 0 || hasRecentActivity || hasDeviceInfo);

  if (!shouldShow) {
    return null;
  }

  if (compact) {
    const hasOmniParser = activity.activeMethods.includes("omniparser") || activity.omniparserModels;
    const deviceBadge = getDeviceBadge(activity.omniparserDevice);
    const models = activity.omniparserModels;

    return (
      <div className={cn("flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2", className)}>
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
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {hasOmniParser ? "OmniParser" : "CV"} Active
            </span>
            {hasOmniParser && activity.omniparserDevice && (
              <span className={cn("text-xs font-medium", deviceBadge.color)}>
                {deviceBadge.icon}
              </span>
            )}
          </div>
          {models && (
            <span className="text-[10px] text-muted-foreground">
              {models.iconDetector} + {models.captionModel}
            </span>
          )}
        </div>
      </div>
    );
  }

  const deviceBadge = getDeviceBadge(activity.omniparserDevice);
  const hasOmniParser = activity.activeMethods.includes("omniparser") || activity.omniparserDevice;

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {hasOmniParser ? "OmniParser Detection" : "CV Detection"}
            </h3>
            {hasOmniParser && (
              <span className={cn("text-xs font-medium flex items-center gap-1", deviceBadge.color)}>
                <span>{deviceBadge.icon}</span>
                <span>{deviceBadge.label}</span>
              </span>
            )}
          </div>
          {activity.omniparserModels && (
            <div className="text-[10px] text-muted-foreground">
              {activity.omniparserModels.iconDetector} + {activity.omniparserModels.captionModel}
            </div>
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
