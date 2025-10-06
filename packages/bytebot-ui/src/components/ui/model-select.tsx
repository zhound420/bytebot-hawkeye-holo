import React from "react";
import { Model } from "@/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, FileText } from "lucide-react";

interface ModelSelectProps {
  models: Model[];
  selectedModel: Model | null;
  onModelChange: (model: Model | null) => void;
  className?: string;
}

export function ModelSelect({
  models,
  selectedModel,
  onModelChange,
  className,
}: ModelSelectProps) {
  // Group models by vision capability
  const visionModels = models.filter((m) => m.supportsVision);
  const textOnlyModels = models.filter((m) => !m.supportsVision);

  // Get icon for model
  const getModelIcon = (model: Model) => {
    return model.supportsVision ? (
      <Eye className="mr-2 h-4 w-4 text-blue-500" />
    ) : (
      <FileText className="mr-2 h-4 w-4 text-amber-500" />
    );
  };

  // Get capability label
  const getCapabilityLabel = (supportsVision: boolean | undefined) => {
    return supportsVision ? "Vision" : "Text-Only";
  };

  return (
    <Select
      value={selectedModel?.name}
      onValueChange={(val) =>
        onModelChange(models.find((m) => m.name === val) || null)
      }
    >
      <SelectTrigger className={className}>
        <div className="flex items-center">
          {selectedModel && getModelIcon(selectedModel)}
          <SelectValue placeholder="Select a model">
            {selectedModel && (
              <span className="flex items-center gap-2">
                {selectedModel.title}
                <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {getCapabilityLabel(selectedModel.supportsVision)}
                </span>
              </span>
            )}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {visionModels.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Eye className="h-3.5 w-3.5" />
              Vision Models
              <span className="text-muted-foreground">(Can process images)</span>
            </SelectLabel>
            {visionModels.map((m) => (
              <SelectItem
                key={m.name}
                value={m.name}
                className="pl-8"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center">
                    <Eye className="mr-2 h-4 w-4 text-blue-500" />
                    {m.title}
                  </span>
                  <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    Vision
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {visionModels.length > 0 && textOnlyModels.length > 0 && (
          <SelectSeparator />
        )}

        {textOnlyModels.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <FileText className="h-3.5 w-3.5" />
              Text-Only Models
              <span className="text-muted-foreground">(Text descriptions only)</span>
            </SelectLabel>
            {textOnlyModels.map((m) => (
              <SelectItem
                key={m.name}
                value={m.name}
                className="pl-8"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="flex items-center">
                    <FileText className="mr-2 h-4 w-4 text-amber-500" />
                    {m.title}
                  </span>
                  <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Text-Only
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
