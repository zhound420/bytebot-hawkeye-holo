"use client";

import React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";

interface ReFailureWarningProps {
  count: number;
  modelName?: string;
}

export function ReFailureWarning({ count, modelName }: ReFailureWarningProps) {
  if (count <= 1) return null;

  const getSuggestedModels = (): string[] => {
    // Suggest stronger models for escalation
    return ["Claude Opus 4", "GPT-4o", "Gemini 2.0 Flash Thinking"];
  };

  const suggestedModels = getSuggestedModels();

  return (
    <div className="rounded-lg border border-red-500 bg-red-50 dark:bg-red-950/20 dark:border-red-700 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <HugeiconsIcon
          icon={AlertCircleIcon}
          className="h-6 w-6 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0"
        />
        <div className="flex-1 space-y-2">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">
              Re-failure Detected
            </h3>
            <p className="text-sm text-red-800 dark:text-red-300">
              {modelName ? (
                <>
                  <strong>{modelName}</strong> has failed{" "}
                  <strong>{count} times</strong> on this task.
                </>
              ) : (
                <>
                  This task has failed <strong>{count} times</strong>.
                </>
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-red-900 dark:text-red-100">
              Recommended Actions:
            </p>
            <ul className="space-y-1 text-sm text-red-800 dark:text-red-300">
              <li className="flex items-start gap-2">
                <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">
                  •
                </span>
                <span>
                  Consider switching to a more capable model:{" "}
                  {suggestedModels.join(", ")}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">
                  •
                </span>
                <span>
                  Review the help context below for specific blocker details
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">
                  •
                </span>
                <span>
                  Break down the task into smaller, more focused steps
                </span>
              </li>
            </ul>
          </div>

          <div className="pt-2 border-t border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-400">
              This model may not be well-suited for this task complexity. Model
              escalation can improve success rates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
