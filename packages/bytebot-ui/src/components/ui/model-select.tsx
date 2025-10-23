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
import { Eye, FileText, Monitor, AlertTriangle } from "lucide-react";

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
  // Group models by provider first (local vs cloud), then by vision capability
  const localModels = models.filter((m) => m.provider === "lmstudio");
  const cloudModels = models.filter((m) => m.provider !== "lmstudio");

  // Within each provider group, separate by vision capability
  const localVisionModels = localModels.filter((m) => m.supportsVision);
  const localTextOnlyModels = localModels.filter((m) => !m.supportsVision);

  const cloudVisionModels = cloudModels.filter((m) => m.supportsVision);
  const cloudTextOnlyModels = cloudModels.filter((m) => !m.supportsVision);

  // Get icon for model based on provider and vision support
  const getModelIcon = (model: Model) => {
    if (model.provider === "lmstudio") {
      return <Monitor className="mr-2 h-4 w-4 text-green-500" />;
    }
    return model.supportsVision ? (
      <Eye className="mr-2 h-4 w-4 text-blue-500" />
    ) : (
      <FileText className="mr-2 h-4 w-4 text-amber-500" />
    );
  };

  // Get capability label
  const getCapabilityLabel = (model: Model) => {
    return model.supportsVision ? "Vision" : "Text-Only";
  };

  // Get badge color based on provider and capability
  const getBadgeClasses = (model: Model) => {
    if (model.provider === "lmstudio") {
      return "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
    }
    return model.supportsVision
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  };

  // Get provider-specific badge
  const getProviderBadge = (model: Model) => {
    switch (model.provider) {
      case "anthropic":
        return (
          <span className="ml-1 rounded-md bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
            Claude
          </span>
        );
      case "openai":
        return (
          <span className="ml-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            OpenAI
          </span>
        );
      case "google":
        return (
          <span className="ml-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            Gemini
          </span>
        );
      case "openrouter":
        return (
          <span className="ml-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            OpenRouter
          </span>
        );
      case "lmstudio":
        return (
          <span className="ml-1 rounded-md bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
            Local
          </span>
        );
      case "proxy":
        return (
          <span className="ml-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-950 dark:text-gray-300">
            Proxy
          </span>
        );
      default:
        return null;
    }
  };

  // Get function calling warning badge if model doesn't support it
  const getFunctionCallingWarning = (model: Model) => {
    if (model.supportsToolCalling === false) {
      return (
        <span
          className="ml-1 flex items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
          title="This model may not support function calling reliably. Consider using a different model for desktop automation tasks."
        >
          <AlertTriangle className="h-3 w-3" />
          Unverified
        </span>
      );
    }
    return null;
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
              <span className="flex items-center gap-1">
                {selectedModel.title}
                {getProviderBadge(selectedModel)}
                <span className={`ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${getBadgeClasses(selectedModel)}`}>
                  {getCapabilityLabel(selectedModel)}
                </span>
                {getFunctionCallingWarning(selectedModel)}
              </span>
            )}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent className="max-h-[400px] overflow-auto">
        {/* Local Models Section (LMStudio) */}
        {localModels.length > 0 && (
          <>
            <SelectGroup>
              <SelectLabel className="flex items-center gap-2 text-xs font-semibold text-green-600 dark:text-green-400">
                <Monitor className="h-3.5 w-3.5" />
                Local Models
                <span className="text-muted-foreground">(Running locally)</span>
              </SelectLabel>

              {/* Local Vision Models */}
              {localVisionModels.map((m) => (
                <SelectItem
                  key={m.name}
                  value={m.name}
                  className="pl-8"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="flex items-center">
                      <Monitor className="mr-2 h-4 w-4 text-green-500" />
                      {m.title}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        Vision
                      </span>
                      {getFunctionCallingWarning(m)}
                    </div>
                  </div>
                </SelectItem>
              ))}

              {/* Local Text-Only Models */}
              {localTextOnlyModels.map((m) => (
                <SelectItem
                  key={m.name}
                  value={m.name}
                  className="pl-8"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="flex items-center">
                      <Monitor className="mr-2 h-4 w-4 text-green-500" />
                      {m.title}
                    </span>
                    {getFunctionCallingWarning(m)}
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>

            {cloudModels.length > 0 && <SelectSeparator />}
          </>
        )}

        {/* Cloud Models Section */}
        {cloudVisionModels.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Eye className="h-3.5 w-3.5" />
              Vision Models
              <span className="text-muted-foreground">(Can process images)</span>
            </SelectLabel>
            {cloudVisionModels.map((m) => (
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
                  <div className="flex items-center gap-1">
                    {getProviderBadge(m)}
                    <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      Vision
                    </span>
                    {getFunctionCallingWarning(m)}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {cloudVisionModels.length > 0 && cloudTextOnlyModels.length > 0 && (
          <SelectSeparator />
        )}

        {cloudTextOnlyModels.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <FileText className="h-3.5 w-3.5" />
              Text-Only Models
              <span className="text-muted-foreground">(Text descriptions only)</span>
            </SelectLabel>
            {cloudTextOnlyModels.map((m) => (
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
                  <div className="flex items-center gap-1">
                    {getProviderBadge(m)}
                    <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Text-Only
                    </span>
                    {getFunctionCallingWarning(m)}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
