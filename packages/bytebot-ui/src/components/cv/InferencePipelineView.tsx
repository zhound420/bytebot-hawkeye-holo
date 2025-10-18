"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface InferencePipeline {
  stage: 'resizing' | 'encoding' | 'inference' | 'parsing' | 'complete' | 'error';
  progress: number; // 0-100
  currentStep: string;
  timing: {
    resizeMs?: number;
    inferenceMs?: number;
    parseMs?: number;
    totalMs?: number;
  };
}

interface InferencePipelineViewProps {
  pipeline: InferencePipeline;
  compact?: boolean;
}

const stageIcons: Record<string, string> = {
  resizing: "📐",
  encoding: "🔢",
  inference: "🧠",
  parsing: "📋",
  complete: "✅",
  error: "❌",
};

const stageColors: Record<string, { bg: string; text: string; border: string }> = {
  resizing: { bg: "bg-blue-500/10", text: "text-blue-600", border: "border-blue-500" },
  encoding: { bg: "bg-purple-500/10", text: "text-purple-600", border: "border-purple-500" },
  inference: { bg: "bg-amber-500/10", text: "text-amber-600", border: "border-amber-500" },
  parsing: { bg: "bg-green-500/10", text: "text-green-600", border: "border-green-500" },
  complete: { bg: "bg-green-500/10", text: "text-green-600", border: "border-green-500" },
  error: { bg: "bg-red-500/10", text: "text-red-600", border: "border-red-500" },
};

export const InferencePipelineView: React.FC<InferencePipelineViewProps> = ({
  pipeline,
  compact = false,
}) => {
  const colors = stageColors[pipeline.stage] || stageColors.inference;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-base">{stageIcons[pipeline.stage]}</span>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className={cn("font-medium", colors.text)}>
              {pipeline.currentStep}
            </span>
            <span className="text-gray-500 text-[10px]">
              {pipeline.progress}%
            </span>
          </div>
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all duration-300", colors.border.replace('border-', 'bg-'))}
              style={{ width: `${pipeline.progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border p-3", colors.bg, colors.border)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{stageIcons[pipeline.stage]}</span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className={cn("text-sm font-semibold", colors.text)}>
              {pipeline.currentStep}
            </h3>
            <span className={cn("text-xs font-medium", colors.text)}>
              {pipeline.progress}%
            </span>
          </div>
          <div className="mt-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-300",
                colors.border.replace('border-', 'bg-')
              )}
              style={{ width: `${pipeline.progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timing Breakdown */}
      {Object.keys(pipeline.timing).length > 0 && (
        <div className="space-y-1 text-xs">
          {pipeline.timing.resizeMs !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-600">Resize:</span>
              <span className="font-mono text-gray-900">
                {pipeline.timing.resizeMs.toFixed(1)}ms
              </span>
            </div>
          )}
          {pipeline.timing.inferenceMs !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-600">Inference:</span>
              <span className="font-mono text-gray-900">
                {pipeline.timing.inferenceMs.toFixed(1)}ms
              </span>
            </div>
          )}
          {pipeline.timing.parseMs !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-600">Parse:</span>
              <span className="font-mono text-gray-900">
                {pipeline.timing.parseMs.toFixed(1)}ms
              </span>
            </div>
          )}
          {pipeline.timing.totalMs !== undefined && (
            <div className="flex justify-between pt-1 border-t border-gray-300">
              <span className="text-gray-700 font-medium">Total:</span>
              <span className="font-mono text-gray-900 font-semibold">
                {pipeline.timing.totalMs.toFixed(1)}ms
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
