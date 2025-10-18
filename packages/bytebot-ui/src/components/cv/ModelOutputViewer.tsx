"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

export interface ModelResponse {
  rawOutput: string;
  outputLength: number;
  tokenEstimate?: number;
  parseStatus: 'success' | 'error';
  parseError?: string;
}

export interface RequestDetails {
  systemPrompt?: string;
  userPrompt?: string;
  modelConfig?: Record<string, unknown>;
  imageInfo?: {
    original: string;
    resized: string;
    scaleFactors: Record<string, number>;
  };
}

interface ModelOutputViewerProps {
  response?: ModelResponse;
  request?: RequestDetails;
}

export const ModelOutputViewer: React.FC<ModelOutputViewerProps> = ({
  response,
  request,
}) => {
  const [activeTab, setActiveTab] = useState<'output' | 'request'>('output');
  const [isExpanded, setIsExpanded] = useState(false);

  if (!response && !request) {
    return null;
  }

  const hasOutput = response && response.rawOutput;
  const hasRequest = request && (request.userPrompt || request.modelConfig);

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-300">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">
            Model Debug Info
          </span>
          {response && (
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium",
                response.parseStatus === 'success'
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              )}
            >
              {response.parseStatus === 'success' ? '✓ Parsed' : '✗ Parse Error'}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Tabs */}
          {hasOutput && hasRequest && (
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('output')}
                className={cn(
                  "flex-1 px-3 py-2 text-xs font-medium transition-colors",
                  activeTab === 'output'
                    ? "bg-white text-blue-600 border-b-2 border-blue-600"
                    : "bg-gray-50 text-gray-600 hover:text-gray-900"
                )}
              >
                Raw Output ({response?.outputLength || 0} chars)
              </button>
              <button
                onClick={() => setActiveTab('request')}
                className={cn(
                  "flex-1 px-3 py-2 text-xs font-medium transition-colors",
                  activeTab === 'request'
                    ? "bg-white text-blue-600 border-b-2 border-blue-600"
                    : "bg-gray-50 text-gray-600 hover:text-gray-900"
                )}
              >
                Request Details
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-3 max-h-96 overflow-y-auto">
            {activeTab === 'output' && response && (
              <div className="space-y-3">
                {/* Parse Error */}
                {response.parseStatus === 'error' && response.parseError && (
                  <div className="bg-red-50 border border-red-200 rounded p-3">
                    <div className="text-xs font-semibold text-red-700 mb-1">
                      Parse Error:
                    </div>
                    <div className="text-xs text-red-600 font-mono">
                      {response.parseError}
                    </div>
                  </div>
                )}

                {/* Raw Output */}
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">
                    Raw Model Output:
                  </div>
                  <div className="bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                      {response.rawOutput}
                    </pre>
                  </div>
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 rounded p-2">
                    <span className="text-gray-600">Output Length:</span>
                    <span className="ml-2 font-mono text-gray-900">
                      {response.outputLength} chars
                    </span>
                  </div>
                  {response.tokenEstimate && (
                    <div className="bg-gray-50 rounded p-2">
                      <span className="text-gray-600">Token Estimate:</span>
                      <span className="ml-2 font-mono text-gray-900">
                        ~{response.tokenEstimate}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'request' && request && (
              <div className="space-y-3">
                {/* User Prompt */}
                {request.userPrompt && (
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-1">
                      User Prompt:
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-gray-800">
                      {request.userPrompt}
                    </div>
                  </div>
                )}

                {/* Model Config */}
                {request.modelConfig && (
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-1">
                      Model Configuration:
                    </div>
                    <div className="bg-gray-900 text-gray-100 rounded p-3">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {JSON.stringify(request.modelConfig, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Image Info */}
                {request.imageInfo && (
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-1">
                      Image Processing:
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="bg-gray-50 rounded p-2">
                        <span className="text-gray-600">Original:</span>
                        <span className="ml-2 font-mono text-gray-900">
                          {request.imageInfo.original}
                        </span>
                      </div>
                      <div className="bg-gray-50 rounded p-2">
                        <span className="text-gray-600">Resized:</span>
                        <span className="ml-2 font-mono text-gray-900">
                          {request.imageInfo.resized}
                        </span>
                      </div>
                      {request.imageInfo.scaleFactors && (
                        <div className="bg-gray-50 rounded p-2">
                          <span className="text-gray-600">Scale Factors:</span>
                          <span className="ml-2 font-mono text-gray-900">
                            {JSON.stringify(request.imageInfo.scaleFactors)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
