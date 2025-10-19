"use client";

import React, { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";

interface ProgressIndicatorProps {
  taskId: string;
  createdAt?: string;
}

export function ProgressIndicator({
  taskId,
  createdAt,
}: ProgressIndicatorProps) {
  const [elapsedTime, setElapsedTime] = useState<string>("0s");

  useEffect(() => {
    if (!createdAt) return;

    const updateElapsedTime = () => {
      try {
        const start = new Date(createdAt).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);

        if (elapsed < 60) {
          setElapsedTime(`${elapsed}s`);
        } else if (elapsed < 3600) {
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          setElapsedTime(`${minutes}m ${seconds}s`);
        } else {
          const hours = Math.floor(elapsed / 3600);
          const minutes = Math.floor((elapsed % 3600) / 60);
          setElapsedTime(`${hours}h ${minutes}m`);
        }
      } catch (error) {
        console.error("Error calculating elapsed time:", error);
      }
    };

    // Update immediately
    updateElapsedTime();

    // Update every second
    const interval = setInterval(updateElapsedTime, 1000);

    return () => clearInterval(interval);
  }, [createdAt]);

  return (
    <div className="rounded-lg border border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-700 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-4 w-4 animate-ping rounded-full bg-green-500 opacity-75" />
          <div className="relative h-2 w-2 rounded-full bg-green-600 dark:bg-green-400" />
        </div>
        <div className="flex-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Loading02Icon}
              className="h-4 w-4 text-green-600 dark:text-green-400 animate-spin"
            />
            <span className="text-sm font-medium text-green-900 dark:text-green-100">
              Task Running
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-green-800 dark:text-green-300">
            <span>
              Elapsed: <strong>{elapsedTime}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
