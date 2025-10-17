"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CVEnforcementBadgeProps {
  className?: string;
  enforceCVFirst?: boolean;
  attemptsMade?: number;
  maxAttempts?: number;
  satisfied?: boolean;
}

export function CVEnforcementBadge({
  className,
  enforceCVFirst = true,
  attemptsMade = 0,
  maxAttempts = 2,
  satisfied = false,
}: CVEnforcementBadgeProps) {
  if (!enforceCVFirst) {
    return null; // Don't show badge if enforcement is disabled
  }

  // Status: enforcing, satisfied, or warning
  const isEnforcing = attemptsMade > 0 && attemptsMade < maxAttempts && !satisfied;
  const isWarning = attemptsMade >= maxAttempts && !satisfied;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border",
        satisfied && "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400",
        isEnforcing && "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
        isWarning && "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
        !satisfied && attemptsMade === 0 && "bg-gray-500/10 border-gray-500/30 text-gray-600 dark:text-gray-400",
        className
      )}
    >
      {satisfied && (
        <>
          <span>✓</span>
          <span>CV-First Satisfied</span>
        </>
      )}
      {isEnforcing && (
        <>
          <span>🔍</span>
          <span>
            CV-First {attemptsMade}/{maxAttempts}
          </span>
        </>
      )}
      {isWarning && (
        <>
          <span>⚠️</span>
          <span>CV-First Max Attempts</span>
        </>
      )}
      {!satisfied && attemptsMade === 0 && (
        <>
          <span>🛡️</span>
          <span>CV-First Enforcement</span>
        </>
      )}
    </div>
  );
}
