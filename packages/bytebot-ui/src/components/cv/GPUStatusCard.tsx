"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface GPUStatusData {
  deviceType: string; // "cuda", "mps", "cpu"
  gpuName: string | null;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  memoryFreeMB: number | null;
  memoryUtilizationPercent: number | null;
  holoModel: string | null;
  profile: string | null;
  avgInferenceTime: number | null;
}

interface GPUStatusCardProps {
  className?: string;
  compact?: boolean;
}

export function GPUStatusCard({ className, compact = false }: GPUStatusCardProps) {
  const [gpuData, setGpuData] = useState<GPUStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchGPUStatus = async () => {
      try {
        const response = await fetch("/api/cv-activity/stream");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (mounted) {
          // Extract GPU data from CV activity snapshot
          const gpuStatus: GPUStatusData = {
            deviceType: data.holoDevice || "unknown",
            gpuName: data.gpuName || null,
            memoryTotalMB: data.gpuMemoryTotalMB || null,
            memoryUsedMB: data.gpuMemoryUsedMB || null,
            memoryFreeMB: data.gpuMemoryFreeMB || null,
            memoryUtilizationPercent: data.gpuMemoryUtilizationPercent || null,
            holoModel: data.holoModel || null,
            profile: data.activeProfile || null,
            avgInferenceTime: data.performance?.averageProcessingTime || null,
          };

          setGpuData(gpuStatus);
          setLoading(false);
        }
      } catch (error) {
        console.debug("GPU status fetch failed:", error);
        setLoading(false);
      }
    };

    // Initial fetch
    fetchGPUStatus();

    // Poll every 2 seconds for updates
    const intervalId = setInterval(fetchGPUStatus, 2000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  if (loading || !gpuData || !gpuData.gpuName) {
    return null; // Don't show card until we have GPU data
  }

  const getDeviceIcon = (deviceType: string): string => {
    const type = deviceType.toLowerCase();
    if (type.includes("cuda")) return "⚡";
    if (type.includes("mps")) return "🍎";
    return "💻";
  };

  const getDeviceColor = (deviceType: string): string => {
    const type = deviceType.toLowerCase();
    if (type.includes("cuda")) return "from-green-500/20 to-green-600/20 border-green-500/30";
    if (type.includes("mps")) return "from-blue-500/20 to-blue-600/20 border-blue-500/30";
    return "from-yellow-500/20 to-yellow-600/20 border-yellow-500/30";
  };

  const getDeviceTextColor = (deviceType: string): string => {
    const type = deviceType.toLowerCase();
    if (type.includes("cuda")) return "text-green-600 dark:text-green-400";
    if (type.includes("mps")) return "text-blue-600 dark:text-blue-400";
    return "text-yellow-600 dark:text-yellow-400";
  };

  const formatMemory = (mb: number | null): string => {
    if (mb === null || mb === undefined) return "N/A";
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)}GB`;
    }
    return `${Math.round(mb)}MB`;
  };

  const formatInferenceTime = (ms: number | null): string => {
    if (ms === null || ms === undefined) return "N/A";
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.round(ms)}ms`;
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card", className)}>
        <span className="text-lg">{getDeviceIcon(gpuData.deviceType)}</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold">{gpuData.gpuName}</span>
          {gpuData.memoryTotalMB && (
            <span className="text-[10px] text-muted-foreground">
              {formatMemory(gpuData.memoryUsedMB)} / {formatMemory(gpuData.memoryTotalMB)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn(
      "bg-gradient-to-r border p-3",
      getDeviceColor(gpuData.deviceType),
      className
    )}>
      <div className="flex items-center gap-3">
        {/* GPU Icon & Name */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-2xl">{getDeviceIcon(gpuData.deviceType)}</span>

          <div className="flex flex-col gap-0.5">
            <span className={cn("text-sm font-semibold", getDeviceTextColor(gpuData.deviceType))}>
              {gpuData.gpuName}
            </span>
            <span className="text-xs text-muted-foreground">
              {gpuData.holoModel || "Holo 1.5-7B Accelerator"}
            </span>
          </div>
        </div>

        {/* Performance Stats */}
        <div className="flex gap-4 text-xs">
          {/* Speed */}
          <div className="flex flex-col items-center">
            <div className="text-muted-foreground text-[10px] uppercase">Speed</div>
            <div className={cn("font-semibold", getDeviceTextColor(gpuData.deviceType))}>
              {formatInferenceTime(gpuData.avgInferenceTime)}
            </div>
          </div>

          {/* Memory (only for CUDA) */}
          {gpuData.memoryTotalMB !== null && (
            <div className="flex flex-col items-center">
              <div className="text-muted-foreground text-[10px] uppercase">Memory</div>
              <div className="font-medium text-foreground">
                {formatMemory(gpuData.memoryUsedMB)} / {formatMemory(gpuData.memoryTotalMB)}
              </div>
              {gpuData.memoryUtilizationPercent !== null && (
                <div className="text-[9px] text-muted-foreground">
                  {Math.round(gpuData.memoryUtilizationPercent)}% used
                </div>
              )}
            </div>
          )}

          {/* Profile */}
          {gpuData.profile && (
            <div className="flex flex-col items-center">
              <div className="text-muted-foreground text-[10px] uppercase">Profile</div>
              <div className="font-medium text-blue-600 dark:text-blue-400">
                {gpuData.profile.toUpperCase()}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
