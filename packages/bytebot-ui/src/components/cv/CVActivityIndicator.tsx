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
  holoDevice?: string;  // cuda, mps, cpu
  holoModel?: string;   // "Holo 1.5-7B (Qwen2.5-VL base)"
  holoPerformanceProfile?: string; // "SPEED", "BALANCED", "QUALITY"
  holoQuantization?: string; // "Q4_K_M", "Q8_0"
  holoProcessingTimeMs?: number; // Last processing time
  gpuName?: string; // GPU device name (e.g., "NVIDIA GeForce RTX 4090")
  gpuMemoryTotalMB?: number; // Total GPU memory in MB
  gpuMemoryUsedMB?: number; // Used GPU memory in MB
  gpuMemoryFreeMB?: number; // Free GPU memory in MB
  gpuMemoryUtilizationPercent?: number; // Memory utilization percentage
}

interface CVDetectionData {
  detections: {
    total: number;
    cached: number;
    cacheHitRate: number;
  };
  methods: {
    holo: number;  // holo-1.5-7b detections
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
  "holo-1.5-7b": "Holo 1.5-7B",
};

const methodColors: Record<string, string> = {
  "template-matching": "bg-blue-500",
  "feature-matching": "bg-purple-500",
  "contour-detection": "bg-green-500",
  "ocr-detection": "bg-yellow-500",
  "holo-1.5-7b": "bg-pink-500",
};

// Helper function to format memory
const formatMemory = (mb: number | null | undefined): string => {
  if (mb === null || mb === undefined) return "N/A";
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  return `${Math.round(mb)}MB`;
};

// Helper function to get device badge and styling
const getDeviceBadge = (device?: string): { icon: string; label: string; color: string } => {
  if (!device) return { icon: "💻", label: "Native", color: "text-blue-500" };

  const deviceLower = device.toLowerCase();
  if (deviceLower.includes("cuda")) {
    return { icon: "⚡", label: "NVIDIA GPU", color: "text-green-500" };
  } else if (deviceLower.includes("mps")) {
    return { icon: "🍎", label: "Apple GPU", color: "text-green-500" };
  } else if (deviceLower.includes("cpu")) {
    return { icon: "💻", label: "CPU", color: "text-blue-500" };
  }
  return { icon: "💻", label: "Native", color: "text-blue-500" };
};

// Helper function to get performance profile badge
const getPerformanceProfileBadge = (profile?: string): { icon: string; label: string; color: string } | null => {
  if (!profile) return null;

  const profileUpper = profile.toUpperCase();
  if (profileUpper === "SPEED") {
    return { icon: "🚀", label: "SPEED", color: "text-blue-600 dark:text-blue-400" };
  } else if (profileUpper === "BALANCED") {
    return { icon: "⚖️", label: "BALANCED", color: "text-purple-600 dark:text-purple-400" };
  } else if (profileUpper === "QUALITY") {
    return { icon: "🎯", label: "QUALITY", color: "text-orange-600 dark:text-orange-400" };
  }
  return null;
};

interface CVActivityIndicatorProps {
  className?: string;
  compact?: boolean;
  inline?: boolean; // New prop for inline chat display
  directVisionMode?: boolean; // If true, show Direct Vision Mode UI instead of CV activity
}

export function CVActivityIndicator({ className, compact = false, inline = false, directVisionMode = false }: CVActivityIndicatorProps) {
  const [activity, setActivity] = useState<CVActivitySnapshot | null>(null);
  const [detectionData, setDetectionData] = useState<CVDetectionData | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchActivity = async () => {
      try {
        const response = await fetch("/api/cv-activity/stream");

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

  // If Direct Vision Mode is enabled, show special UI
  if (directVisionMode) {
    // Show compact Direct Vision Mode indicator
    return (
      <div className={cn(
        "rounded-lg border border-purple-500/20 bg-purple-500/10 px-2 py-1.5 dark:border-purple-500/30 dark:bg-purple-500/20",
        className
      )}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
            Direct Vision Mode
          </span>
          <span className="text-[10px] font-medium text-foreground">
            🎯 Native Model Vision
          </span>
          <span className="text-[9px] text-muted-foreground">
            Holo CV disabled
          </span>
        </div>
      </div>
    );
  }

  // Show if: active methods OR recent history OR device/model info available
  const hasRecentActivity = (activity?.performance?.totalMethodsExecuted ?? 0) > 0;
  const hasDeviceInfo = activity?.holoDevice !== undefined;
  const hasModelInfo = activity?.holoModel !== undefined;

  // For inline mode (chat panel), only show if there's actual CV activity happening
  // Don't show just because device info exists
  let shouldShow = false;
  if (inline) {
    // Show inline status bar when there's ANY detection or click history
    // This creates persistent chat history of CV activity
    const hasDetectionHistory = (detectionData?.recentDetections?.length ?? 0) > 0;
    const hasClickHistory = (detectionData?.recentClicks?.length ?? 0) > 0;
    const hasActiveWork = Boolean(activity && activity.totalActiveCount > 0);

    shouldShow = hasActiveWork || hasDetectionHistory || hasClickHistory;
  } else {
    // For status card (top), show if any activity or device info
    shouldShow = Boolean(activity && (activity.totalActiveCount > 0 || hasRecentActivity || hasDeviceInfo || hasModelInfo));
  }

  if (!shouldShow) {
    return null;
  }

  // Inline mode for chat panel
  if (inline) {
    const hasHolo = activity?.activeMethods?.includes("holo-1.5-7b") ||
                     activity?.holoModel;
    const deviceBadge = getDeviceBadge(activity?.holoDevice);
    const profileBadge = getPerformanceProfileBadge(activity?.holoPerformanceProfile);

    return (
      <div className={cn("rounded-lg border border-border bg-card/50 dark:bg-card/30 px-3 py-2 backdrop-blur-sm", className)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {activity?.activeMethods?.map((method) => (
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
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {hasHolo ? "🔍 AI Computer Vision" : "🔍 CV Detection"}
                </span>
                {profileBadge && (
                  <span className={cn("text-[9px] font-semibold flex items-center gap-0.5", profileBadge.color)} title={`Holo ${profileBadge.label} mode`}>
                    <span>{profileBadge.icon}</span>
                  </span>
                )}
              </div>
              {activity?.gpuName && (
                <span className="text-[9px] text-muted-foreground">
                  {activity.gpuName}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            {hasHolo && activity?.holoDevice && (
              <span className={cn("text-[10px] font-medium flex items-center gap-0.5", deviceBadge.color)}>
                <span>{deviceBadge.icon}</span>
                <span>{deviceBadge.label}</span>
              </span>
            )}
            {activity?.gpuMemoryTotalMB && (
              <span className="text-[9px] text-muted-foreground">
                {formatMemory(activity.gpuMemoryUsedMB)} / {formatMemory(activity.gpuMemoryTotalMB)}
              </span>
            )}
          </div>
        </div>

        {/* Active Methods */}
        {activity && activity.totalActiveCount > 0 && (
          <div className="space-y-1 mb-2">
            {activity.activeMethods.map((method) => {
              const detail = Object.values(activity.methodDetails).find(d => d.method === method);
              const displayName = methodDisplayNames[method] || method;
              const color = methodColors[method] || "bg-gray-500";
              const elapsed = detail?.startTime ? Math.round((Date.now() - detail.startTime) / 100) / 10 : 0;

              // Enhanced Holo info display
              const isHolo = method === 'holo-1.5-7b';
              const holoTask = isHolo ? detail?.metadata?.task_description : null;
              const holoProfile = isHolo ? detail?.metadata?.performance_profile?.toUpperCase() || detail?.metadata?.performanceProfile?.toUpperCase() : null;
              const holoQuantization = isHolo ? detail?.metadata?.quantization : null;
              const holoDetectionStatus = isHolo ? detail?.metadata?.detection_status : null;

              return (
                <div key={method} className="flex flex-col gap-0.5 text-xs">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", color)} />
                    <span className="font-medium">{displayName}</span>
                    {isHolo && holoProfile && (
                      <span className="text-[9px] text-muted-foreground">({holoProfile})</span>
                    )}
                    {isHolo && holoQuantization && (
                      <span className="text-[9px] text-muted-foreground">{holoQuantization}</span>
                    )}
                    <span className="text-red-500 dark:text-red-400 text-[9px]" title="Live processing">🔴</span>
                    {elapsed > 0 && (
                      <span className="text-muted-foreground ml-auto">{elapsed}s</span>
                    )}
                  </div>
                  {/* Show Holo task description */}
                  {isHolo && holoTask && (
                    <span className="text-[10px] text-muted-foreground italic ml-4">
                      {holoTask}
                    </span>
                  )}
                  {/* Show detection status after processing */}
                  {isHolo && holoDetectionStatus && elapsed > 0.5 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400 ml-4">
                      {holoDetectionStatus}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Recent Detection History */}
        {detectionData && detectionData.recentDetections.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground mb-1">Recent Detections</div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {detectionData.recentDetections.slice(0, 5).map((detection, idx) => (
                <div key={`${detection.timestamp}-${idx}`} className="flex items-center gap-2">
                  <div className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-medium whitespace-nowrap",
                    detection.primaryMethod === 'holo-1.5-7b' && "bg-pink-500/20 text-pink-600 dark:bg-pink-500/30 dark:text-pink-300",
                    detection.primaryMethod !== 'holo-1.5-7b' && "bg-gray-500/20 dark:bg-gray-500/30"
                  )}>
                    {detection.primaryMethod}
                  </div>
                  <span className="text-[10px] text-foreground truncate flex-1" title={detection.description}>
                    &quot;{detection.description}&quot;
                  </span>
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400 whitespace-nowrap">
                    {detection.elementsFound} found
                  </span>
                  {detection.cached && (
                    <span className="text-[9px] text-blue-600 dark:text-blue-400">⚡</span>
                  )}
                  <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                    {detection.duration}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Click History */}
        {detectionData && detectionData.recentClicks.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground mb-1">Recent Clicks</div>
            <div className="space-y-1.5 max-h-24 overflow-y-auto">
              {detectionData.recentClicks.slice(0, 5).map((click, idx) => (
                <div key={`${click.timestamp}-${idx}`} className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs",
                    click.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  )}>
                    {click.success ? "✓" : "❌"}
                  </span>
                  <span className="text-[10px] font-mono text-foreground truncate flex-1" title={click.elementId}>
                    [{click.elementId}]
                  </span>
                  <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                    {click.detectionMethod}
                  </span>
                </div>
              ))}
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
    const hasHolo = activity?.activeMethods?.includes("holo-1.5-7b") ||
                     activity?.holoModel;
    const deviceBadge = getDeviceBadge(activity?.holoDevice);

    return (
      <div className={cn("flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2", className)}>
        <div className="flex items-center gap-1">
          {activity?.activeMethods?.map((method) => (
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
              {hasHolo ? "AI Vision" : "CV"} Active
            </span>
            {hasHolo && activity?.holoDevice && (
              <span className={cn("text-xs font-medium", deviceBadge.color)}>
                {deviceBadge.icon}
              </span>
            )}
          </div>
          {activity?.gpuName && (
            <span className="text-[10px] text-muted-foreground">
              {activity.gpuName}
            </span>
          )}
          {activity?.gpuMemoryTotalMB && (
            <div className="flex flex-col gap-0.5 w-full">
              <span className="text-[9px] text-muted-foreground">
                {formatMemory(activity.gpuMemoryUsedMB)} / {formatMemory(activity.gpuMemoryTotalMB)}
              </span>
              {/* GPU Memory Progress Bar */}
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300 ease-in-out",
                    (() => {
                      const usagePercent = activity.gpuMemoryTotalMB > 0 && activity.gpuMemoryUsedMB !== undefined
                        ? ((activity.gpuMemoryUsedMB || 0) / activity.gpuMemoryTotalMB) * 100
                        : 0;
                      if (usagePercent < 50) return "bg-green-500";
                      if (usagePercent < 80) return "bg-yellow-500";
                      return "bg-red-500";
                    })()
                  )}
                  style={{
                    width: activity.gpuMemoryTotalMB > 0 && activity.gpuMemoryUsedMB !== undefined
                      ? `${Math.min(100, ((activity.gpuMemoryUsedMB || 0) / activity.gpuMemoryTotalMB) * 100)}%`
                      : "0%"
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const deviceBadge = getDeviceBadge(activity?.holoDevice);
  const hasHolo = activity?.activeMethods?.includes("holo-1.5-7b") ||
                   activity?.holoDevice;

  return (
    <div className={cn("rounded-lg border border-border bg-card px-2 py-1.5", className)}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <h3 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {hasHolo ? "AI Computer Vision" : "CV Detection"}
            </h3>
            {hasHolo && (
              <span className={cn("text-[9px] font-medium flex items-center gap-0.5", deviceBadge.color)}>
                <span>{deviceBadge.icon}</span>
                <span>{deviceBadge.label}</span>
              </span>
            )}
          </div>
          {activity?.gpuName && (
            <div className="text-[8px] font-medium text-foreground">
              {activity.gpuName}
            </div>
          )}
          {activity?.gpuMemoryTotalMB && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[8px] text-muted-foreground">
                {formatMemory(activity.gpuMemoryUsedMB)} / {formatMemory(activity.gpuMemoryTotalMB)}
              </div>
              {/* GPU Memory Progress Bar */}
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300 ease-in-out",
                    (() => {
                      const usagePercent = activity.gpuMemoryTotalMB > 0 && activity.gpuMemoryUsedMB !== undefined
                        ? ((activity.gpuMemoryUsedMB || 0) / activity.gpuMemoryTotalMB) * 100
                        : 0;
                      if (usagePercent < 50) return "bg-green-500";
                      if (usagePercent < 80) return "bg-yellow-500";
                      return "bg-red-500";
                    })()
                  )}
                  style={{
                    width: activity.gpuMemoryTotalMB > 0 && activity.gpuMemoryUsedMB !== undefined
                      ? `${Math.min(100, ((activity.gpuMemoryUsedMB || 0) / activity.gpuMemoryTotalMB) * 100)}%`
                      : "0%"
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <span className="text-[9px] text-muted-foreground">
          {activity?.totalActiveCount} {activity?.totalActiveCount === 1 ? "method" : "methods"}
        </span>
      </div>

      <div className="space-y-1">
        {activity?.activeMethods?.map((method) => {
          const detail = activity?.methodDetails?.[method];
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

      {activity && activity.performance.totalMethodsExecuted > 0 && (
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
