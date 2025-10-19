"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface LearningEntry {
  app: string;
  element: string;
  confidence: number;
  hits: number;
  successCount: number;
  failureCount: number;
  lastUsed: number;
}

interface LearningStats {
  totalEntries: number;
  avgConfidence: number;
  totalSuccesses: number;
  totalFailures: number;
  totalHits: number;
  successRate: number;
  byApplication: Record<
    string,
    {
      count: number;
      avgConfidence: number;
      totalHits: number;
    }
  >;
}

export function CoordinateLearningMetrics({ className }: { className?: string }) {
  const [stats, setStats] = React.useState<LearningStats | null>(null);
  const [topEntries, setTopEntries] = React.useState<LearningEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, topRes] = await Promise.all([
          fetch("/api/learning-metrics/stats"),
          fetch("/api/learning-metrics/top"),
        ]);

        if (!statsRes.ok || !topRes.ok) {
          throw new Error("Failed to fetch learning metrics");
        }

        const statsData = await statsRes.json();
        const topData = await topRes.json();

        setStats(statsData);
        setTopEntries(topData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch learning metrics:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();

    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

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

  if (error || !stats) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          className
        )}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Coordinate Learning
        </h3>
        <p className="text-sm text-muted-foreground">
          {error || "No data available"}
        </p>
      </div>
    );
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.7) return "text-green-500";
    if (confidence >= 0.4) return "text-yellow-500";
    return "text-red-500";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.7) return "High";
    if (confidence >= 0.4) return "Medium";
    return "Low";
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
          Coordinate Learning
        </h3>
        <span className="text-xs text-muted-foreground">
          🎯 UI Element Confidence
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
        <div>
          <div className="text-muted-foreground">Learned</div>
          <div className="font-medium text-foreground">
            {stats.totalEntries}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Avg Confidence</div>
          <div
            className={cn(
              "font-medium",
              getConfidenceColor(stats.avgConfidence)
            )}
          >
            {Math.round(stats.avgConfidence * 100)}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Success Rate</div>
          <div className="font-medium text-green-500">
            {Math.round(stats.successRate * 100)}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total Uses</div>
          <div className="font-medium text-foreground">{stats.totalHits}</div>
        </div>
      </div>

      {/* Top Learned Elements */}
      {topEntries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">
            Top Learned Elements
          </h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {topEntries.slice(0, 5).map((entry, i) => (
              <div
                key={`${entry.app}-${entry.element}-${i}`}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">
                    {entry.element}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {entry.app} • {entry.hits} uses
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      getConfidenceColor(entry.confidence)
                    )}
                  >
                    {getConfidenceLabel(entry.confidence)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(entry.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Applications breakdown */}
      {Object.keys(stats.byApplication).length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">
            By Application
          </h4>
          <div className="space-y-1">
            {Object.entries(stats.byApplication).map(([app, appStats]) => (
              <div
                key={app}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-foreground capitalize">{app}</span>
                <span className="text-muted-foreground">
                  {appStats.count} elements • {appStats.totalHits} uses
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
