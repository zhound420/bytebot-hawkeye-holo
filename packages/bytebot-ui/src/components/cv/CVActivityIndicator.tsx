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

interface CVDetectionData {
  detections: {
    total: number;
    cached: number;
    cacheHitRate: number;
  };
  methods: {
    omniparser: number;
    ocr: number;
    template: number;
    feature: number;
    contour: number;
  };
  clicks: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  recentDetections: Array<{
    timestamp: string;
    description: string;
    elementsFound: number;
    primaryMethod: string;
    cached: boolean;
    duration: number;
  }>;
  recentClicks: Array<{
    timestamp: string;
    elementId: string;
    success: boolean;
    detectionMethod: string;
  }>;
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
    return { icon: "⚡", label: "NVIDIA GPU", color: "text-green-500" };
  } else if (deviceLower.includes("mps")) {
    return { icon: "🍎", label: "Apple Silicon", color: "text-green-500" };
  } else if (deviceLower.includes("cpu")) {
    return { icon: "💻", label: "CPU", color: "text-blue-500" };
  }
  return { icon: "💻", label: "Local", color: "text-blue-500" };
};

interface CVActivityIndicatorProps {
  className?: string;
  compact?: boolean;
  inline?: boolean; // New prop for inline chat display
}

export function CVActivityIndicator({ className, compact = false, inline = false }: CVActivityIndicatorProps) {
  const [activity, setActivity] = useState<CVActivitySnapshot | null>(null);
  const [detectionData, setDetectionData] = useState<CVDetectionData | null>(null);

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

    const fetchDetectionData = async () => {
      if (!inline) return; // Only fetch for inline mode

      try {
        const response = await fetch("/api/cv-detection/summary");
        if (!response.ok) return;

        const data = await response.json();
        if (mounted) {
          setDetectionData(data);
        }
      } catch (error) {
        console.debug("Detection data fetch failed:", error);
      }
    };

    // Initial fetch
    fetchActivity();
    fetchDetectionData();

    // Poll every 500ms for real-time updates
    const intervalId = setInterval(() => {
      fetchActivity();
      fetchDetectionData();
    }, 500);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [inline]);

  // Show if: active methods OR recent history OR device/model info available
  const hasRecentActivity = (activity?.performance?.totalMethodsExecuted ?? 0) > 0;
  const hasDeviceInfo = activity?.omniparserDevice !== undefined;
  const hasModelInfo = activity?.omniparserModels !== undefined;

  // For inline mode (chat panel), only show if there's actual CV activity happening
  // Don't show just because device info exists
  let shouldShow = false;
  if (inline) {
    // Show inline status bar only when:
    // 1. There are active methods running now, OR
    // 2. There are recent detections/clicks (within last 5 minutes to show persistent activity)
    const hasActiveWork = Boolean(activity && activity.totalActiveCount > 0);
    const latestDetection = detectionData?.recentDetections?.[0];
    const latestClick = detectionData?.recentClicks?.[0];

    const hasRecentDetection = Boolean(latestDetection &&
      (Date.now() - new Date(latestDetection.timestamp).getTime()) < 300000); // 5 minutes
    const hasRecentClick = Boolean(latestClick &&
      (Date.now() - new Date(latestClick.timestamp).getTime()) < 300000); // 5 minutes

    shouldShow = hasActiveWork || hasRecentDetection || hasRecentClick;
  } else {
    // For status card (top), show if any activity or device info
    shouldShow = Boolean(activity && (activity.totalActiveCount > 0 || hasRecentActivity || hasDeviceInfo || hasModelInfo));
  }

  if (!shouldShow) {
    return null;
  }

  // Inline mode for chat panel
  if (inline) {
    const hasOmniParser = activity.activeMethods.includes("omniparser") || activity.omniparserModels;
    const deviceBadge = getDeviceBadge(activity.omniparserDevice);
    const latestDetection = detectionData?.recentDetections?.[0];
    const latestClick = detectionData?.recentClicks?.[0];

    return (
      <div className={cn("rounded-lg border border-border bg-card/50 dark:bg-card/30 px-3 py-2 backdrop-blur-sm", className)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {activity.activeMethods.map((method) => (
                <div
                  key={method}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full animate-pulse",
                    methodColors[method] || "bg-gray-500"
                  )}
                  title={methodDisplayNames[method] || method}
                />
              ))}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">
                {hasOmniParser ? "🔍 OmniParser" : "🔍 CV Detection"}
              </span>
              {activity.omniparserModels && (
                <span className="text-[9px] text-muted-foreground">
                  {activity.omniparserModels.iconDetector} + {activity.omniparserModels.captionModel}
                </span>
              )}
            </div>
          </div>
          {hasOmniParser && activity.omniparserDevice && (
            <span className={cn("text-[10px] font-medium flex items-center gap-0.5", deviceBadge.color)}>
              <span>{deviceBadge.icon}</span>
              <span>{deviceBadge.label}</span>
            </span>
          )}
        </div>

        {/* Active Methods */}
        {activity.totalActiveCount > 0 && (
          <div className="space-y-1 mb-2">
            {activity.activeMethods.map((method) => {
              const detail = Object.values(activity.methodDetails).find(d => d.method === method);
              const displayName = methodDisplayNames[method] || method;
              const color = methodColors[method] || "bg-gray-500";
              const elapsed = detail?.startTime ? Math.round((Date.now() - detail.startTime) / 100) / 10 : 0;

              return (
                <div key={method} className="flex items-center gap-2 text-xs">
                  <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", color)} />
                  <span className="font-medium">{displayName}</span>
                  {elapsed > 0 && (
                    <span className="text-muted-foreground ml-auto">{elapsed}s</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Latest Detection */}
        {latestDetection && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground mb-1">Latest Detection</div>
            <div className="flex items-center gap-2">
              <div className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-medium",
                latestDetection.primaryMethod === 'omniparser' && "bg-pink-500/20 text-pink-600 dark:bg-pink-500/30 dark:text-pink-300",
                latestDetection.primaryMethod !== 'omniparser' && "bg-gray-500/20 dark:bg-gray-500/30"
              )}>
                {latestDetection.primaryMethod}
              </div>
              <span className="text-[10px] text-foreground truncate flex-1">
                &quot;{latestDetection.description}&quot;
              </span>
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                {latestDetection.elementsFound} found
              </span>
              {latestDetection.cached && (
                <span className="text-[9px] text-blue-600 dark:text-blue-400">⚡</span>
              )}
            </div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              {latestDetection.duration}ms
            </div>
          </div>
        )}

        {/* Latest Click */}
        {latestClick && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground mb-1">Latest Click</div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs",
                latestClick.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              )}>
                {latestClick.success ? "✓" : "❌"}
              </span>
              <span className="text-[10px] font-mono text-foreground">
                [{latestClick.elementId}]
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {latestClick.detectionMethod}
              </span>
            </div>
          </div>
        )}

        {/* Statistics */}
        {detectionData && (
          <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-3 gap-2 text-[9px]">
            <div>
              <div className="text-muted-foreground">Detections</div>
              <div className="font-medium">{detectionData.detections.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Clicks</div>
              <div className="font-medium">{detectionData.clicks.total}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Success</div>
              <div className="font-medium">{Math.round((detectionData.clicks.successRate || 0) * 100)}%</div>
            </div>
          </div>
        )}
      </div>
    );
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
    <div className={cn("rounded-lg border border-border bg-card px-2 py-1.5", className)}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <h3 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {hasOmniParser ? "OmniParser" : "CV Detection"}
            </h3>
            {hasOmniParser && (
              <span className={cn("text-[9px] font-medium flex items-center gap-0.5", deviceBadge.color)}>
                <span>{deviceBadge.icon}</span>
                <span>{deviceBadge.label}</span>
              </span>
            )}
          </div>
          {activity.omniparserModels && (
            <div className="text-[8px] text-muted-foreground">
              {activity.omniparserModels.iconDetector} + {activity.omniparserModels.captionModel}
            </div>
          )}
        </div>
        <span className="text-[9px] text-muted-foreground">
          {activity.totalActiveCount} {activity.totalActiveCount === 1 ? "method" : "methods"}
        </span>
      </div>

      <div className="space-y-1">
        {activity.activeMethods.map((method) => {
          const detail = activity.methodDetails[method];
          const displayName = methodDisplayNames[method] || method;
          const color = methodColors[method] || "bg-gray-500";

          return (
            <div key={method} className="flex items-center gap-1">
              <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", color)} />
              <span className="text-[10px] font-medium">{displayName}</span>
              {detail?.startTime && (
                <span className="text-[9px] text-muted-foreground ml-auto">
                  {Math.round((Date.now() - detail.startTime) / 100) / 10}s
                </span>
              )}
            </div>
          );
        })}
      </div>

      {activity.performance.totalMethodsExecuted > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-border">
          <div className="grid grid-cols-3 gap-1 text-[9px]">
            <div>
              <div className="text-muted-foreground">Avg</div>
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
          </div>
        </div>
      )}
    </div>
  );
}
