"use client";

import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert01Icon } from "@hugeicons/core-free-icons";
import { Task } from "@/types";

interface HelpContextCardProps {
  helpContext: NonNullable<Task["helpContext"]>;
}

export function HelpContextCard({ helpContext }: HelpContextCardProps) {
  const formatElapsedTime = (ms?: number): string => {
    if (!ms) return "N/A";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getBlockerBadgeColor = (blockerType: string): string => {
    switch (blockerType) {
      case "timeout":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/20";
      case "modal_dialog":
        return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 ring-yellow-500/20";
      case "permission_denied":
        return "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20";
      case "element_not_found":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 ring-gray-500/20";
    }
  };

  return (
    <Card className="border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20 dark:border-yellow-700">
      <CardHeader>
        <div className="flex items-start gap-3">
          <HugeiconsIcon
            icon={Alert01Icon}
            className="h-6 w-6 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0"
          />
          <div className="flex-1 space-y-1">
            <CardTitle className="text-yellow-900 dark:text-yellow-100">
              Task Needs Help
            </CardTitle>
            <CardDescription className="text-yellow-800 dark:text-yellow-300">
              {helpContext.message}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Blocker Information */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground font-medium">Reason:</span>
            <span className="ml-2 text-foreground capitalize">
              {helpContext.reason.replace(/_/g, " ")}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground font-medium">
              Blocker Type:
            </span>
            <span
              className={`ml-2 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${getBlockerBadgeColor(helpContext.blockerType)}`}
            >
              {helpContext.blockerType.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        {/* Timing Information */}
        {helpContext.elapsedMs && (
          <div className="text-sm">
            <span className="text-muted-foreground font-medium">
              Time Elapsed:
            </span>
            <span className="ml-2 text-foreground">
              {formatElapsedTime(helpContext.elapsedMs)}
            </span>
          </div>
        )}

        {/* Suggested Actions */}
        {helpContext.suggestedActions &&
          helpContext.suggestedActions.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                Suggested Actions:
              </div>
              <ul className="space-y-1.5">
                {helpContext.suggestedActions.map((action, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5">
                      •
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {/* Timestamp */}
        <div className="pt-2 border-t border-yellow-200 dark:border-yellow-800">
          <span className="text-xs text-muted-foreground">
            Occurred at {formatTimestamp(helpContext.timestamp)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
