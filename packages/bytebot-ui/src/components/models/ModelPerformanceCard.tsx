"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ModelLeaderboardEntry {
  modelName: string;
  successRate: number;
  totalTasks: number;
  avgDurationMs: number;
}

interface LeaderboardResponse {
  leaderboard: ModelLeaderboardEntry[];
  timestamp: string;
}

export function ModelPerformanceCard({ className }: { className?: string }) {
  const [data, setData] = React.useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/tasks/models/leaderboard?limit=5");

        if (!res.ok) {
          throw new Error("Failed to fetch model leaderboard");
        }

        const leaderboardData = await res.json();
        setData(leaderboardData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch model leaderboard:", err);
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

  if (error || !data || data.leaderboard.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          className
        )}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Model Performance
        </h3>
        <p className="text-sm text-muted-foreground">
          {error || "No performance data yet"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Complete tasks to see model statistics
        </p>
      </div>
    );
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 0.8) return "text-green-500";
    if (rate >= 0.6) return "text-yellow-500";
    return "text-red-500";
  };

  const getSuccessRateBadge = (rate: number) => {
    if (rate >= 0.8) return "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
    if (rate >= 0.6) return "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
    return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
  };

  const getRankEmoji = (index: number) => {
    if (index === 0) return "🥇";
    if (index === 1) return "🥈";
    if (index === 2) return "🥉";
    return `${index + 1}.`;
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
          Model Performance
        </h3>
        <span className="text-xs text-muted-foreground">
          📊 Leaderboard
        </span>
      </div>

      {/* Leaderboard */}
      <div className="space-y-2">
        {data.leaderboard.map((entry, index) => (
          <div
            key={entry.modelName}
            className="flex items-center justify-between text-xs p-2 rounded bg-muted/50"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm">{getRankEmoji(index)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {entry.modelName}
                </div>
                <div className="text-muted-foreground text-xs">
                  {entry.totalTasks} task{entry.totalTasks !== 1 ? 's' : ''} • {Math.round(entry.avgDurationMs / 1000)}s avg
                </div>
              </div>
            </div>
            <span
              className={cn(
                "ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
                getSuccessRateBadge(entry.successRate)
              )}
            >
              {Math.round(entry.successRate * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Footer Note */}
      <div className="mt-3 pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Success rates based on empirical task outcomes
        </p>
      </div>
    </div>
  );
}
