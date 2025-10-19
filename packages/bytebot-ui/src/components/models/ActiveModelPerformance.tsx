"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ModelPerformanceStats {
  totalTasks: number;
  successRate: number;
  avgDurationMs: number;
  avgToolCalls: number;
  avgClicks: number;
  errorRate: number;
  helpRate: number;
}

interface CurrentPerformanceResponse {
  modelName: string | null;
  stats: ModelPerformanceStats | null;
  successRate: number | null;
  hasData: boolean;
  timestamp: string;
}

interface ActiveModelPerformanceProps {
  modelName?: string | null;
  className?: string;
}

export function ActiveModelPerformance({
  modelName,
  className,
}: ActiveModelPerformanceProps) {
  const [data, setData] = React.useState<CurrentPerformanceResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!modelName) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const res = await fetch(
          `/api/tasks/models/current-performance?modelName=${encodeURIComponent(modelName)}`
        );

        if (!res.ok) {
          throw new Error("Failed to fetch model performance");
        }

        const perfData = await res.json();
        setData(perfData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch model performance:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();

    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [modelName]);

  if (!modelName) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          className
        )}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Active Model Performance
        </h3>
        <p className="text-sm text-muted-foreground">
          No active model
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3 animate-pulse",
          className
        )}
      >
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-3/4 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error || !data || !data.hasData) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          className
        )}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Active Model Performance
        </h3>
        <div className="text-sm font-medium text-foreground truncate mb-2">
          {modelName}
        </div>
        <p className="text-sm text-muted-foreground">
          {error || "No data yet"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Complete 5+ tasks to see statistics
        </p>
      </div>
    );
  }

  const stats = data.stats!;

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 0.8) return "text-green-500";
    if (rate >= 0.6) return "text-yellow-500";
    return "text-red-500";
  };

  const getAutonomyColor = (helpRate: number) => {
    const autonomy = 1 - helpRate;
    if (autonomy >= 0.9) return "text-green-500";
    if (autonomy >= 0.7) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 dark:border-border/60 dark:bg-muted",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active Model Performance
        </h3>
        <span className="text-xs text-muted-foreground">
          📈 Live Stats
        </span>
      </div>

      {/* Model Name */}
      <div className="mb-3">
        <div className="text-sm font-medium text-foreground truncate">
          {modelName}
        </div>
        <div className="text-xs text-muted-foreground">
          {stats.totalTasks} task{stats.totalTasks !== 1 ? 's' : ''} completed
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div>
          <div className="text-muted-foreground">Success</div>
          <div
            className={cn("font-medium text-sm", getSuccessRateColor(stats.successRate))}
          >
            {Math.round(stats.successRate * 100)}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Avg Time</div>
          <div className="font-medium text-sm text-foreground">
            {Math.round(stats.avgDurationMs / 1000)}s
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Autonomy</div>
          <div
            className={cn("font-medium text-sm", getAutonomyColor(stats.helpRate))}
          >
            {Math.round((1 - stats.helpRate) * 100)}%
          </div>
        </div>
      </div>

      {/* Detailed Stats */}
      <div className="pt-2 border-t border-border space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Tool Calls</span>
          <span className="font-medium text-foreground">
            {Math.round(stats.avgToolCalls)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Clicks</span>
          <span className="font-medium text-foreground">
            {Math.round(stats.avgClicks)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Error Rate</span>
          <span className={cn("font-medium", stats.errorRate > 0.2 ? "text-red-500" : "text-foreground")}>
            {Math.round(stats.errorRate * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
