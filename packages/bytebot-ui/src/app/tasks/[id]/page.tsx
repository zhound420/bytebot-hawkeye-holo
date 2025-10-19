"use client";

import React, { useEffect, useRef } from "react";
import { Header } from "@/components/layout/Header";
import { ChatContainer } from "@/components/messages/ChatContainer";
import { DesktopContainer } from "@/components/ui/desktop-container";
import { useChatSession } from "@/hooks/useChatSession";
import { useScrollScreenshot } from "@/hooks/useScrollScreenshot";
import { useParams, useRouter } from "next/navigation";
import { Role, TaskStatus } from "@/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreVerticalCircle01Icon,
  WavingHand01Icon,
} from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { VirtualDesktopStatus } from "@/components/VirtualDesktopStatusHeader";
import { TelemetryStatus } from "@/components/telemetry/TelemetryStatus";
import { TaskPromptSummary } from "@/components/tasks/TaskPromptSummary";
import { CVActivityIndicator } from "@/components/cv/CVActivityIndicator";
import { HelpContextCard } from "@/components/tasks/HelpContextCard";
import { ReFailureWarning } from "@/components/tasks/ReFailureWarning";
import { ProgressIndicator } from "@/components/tasks/ProgressIndicator";

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    groupedMessages,
    taskStatus,
    control,
    input,
    setInput,
    isLoading,
    isLoadingSession,
    isLoadingMoreMessages,
    hasMoreMessages,
    loadMoreMessages,
    handleAddMessage,
    handleTakeOverTask,
    handleResumeTask,
    handleCancelTask,
    currentTaskId,
    taskModel,
    directVisionMode,
    initialPrompt,
    // Phase 4 UI: UX improvement fields
    helpContext,
    needsHelpCount,
    createdAt,
  } = useChatSession({ initialTaskId: taskId });

  // Determine if task is inactive (show screenshot) or active (show VNC)
  function isTaskInactive(): boolean {
    return (
      taskStatus === TaskStatus.COMPLETED ||
      taskStatus === TaskStatus.FAILED ||
      taskStatus === TaskStatus.CANCELLED
    );
  }

  // Determine if user can take control
  function canTakeOver(): boolean {
    return control === Role.ASSISTANT && taskStatus === TaskStatus.RUNNING;
  }

  // Determine if user has control or is in takeover mode
  function hasUserControl(): boolean {
    return (
      control === Role.USER &&
      (taskStatus === TaskStatus.RUNNING ||
        taskStatus === TaskStatus.NEEDS_HELP)
    );
  }

  // Determine if task can be cancelled
  function canCancel(): boolean {
    return (
      taskStatus === TaskStatus.RUNNING || taskStatus === TaskStatus.NEEDS_HELP
    );
  }

  // Determine VNC mode - interactive when user has control, view-only otherwise
  function vncViewOnly(): boolean {
    return !hasUserControl();
  }

  // Use scroll screenshot hook for inactive tasks
  const { currentScreenshot } = useScrollScreenshot({
    messages,
    scrollContainerRef: chatContainerRef,
  });

  const taskInactive = isTaskInactive();

  const modelTitle = taskModel?.title?.trim() || taskModel?.name?.trim();
  const modelProvider = taskModel?.provider?.trim();
  const modelIdentifier =
    modelTitle && modelProvider && modelProvider !== modelTitle
      ? `${modelTitle} (${modelProvider})`
      : modelTitle || modelProvider;
  const modelNameDetails =
    modelTitle && taskModel?.name && taskModel.name !== modelTitle
      ? taskModel.name
      : undefined;

  // For inactive tasks, auto-load all messages for proper screenshot navigation
  useEffect(() => {
    if (taskInactive && hasMoreMessages && !isLoadingMoreMessages) {
      loadMoreMessages();
    }
  }, [
    taskInactive,
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
  ]);

  // Map each message ID to its flat index for screenshot scroll logic
  const messageIdToIndex = React.useMemo(() => {
    const map: Record<string, number> = {};
    messages.forEach((msg, idx) => {
      map[msg.id] = idx;
    });
    return map;
  }, [messages]);

  // Redirect if task ID doesn't match current task
  useEffect(() => {
    if (currentTaskId && currentTaskId !== taskId) {
      router.push(`/tasks/${currentTaskId}`);
    }
  }, [currentTaskId, taskId, router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />

      <main className="m-2 flex-1 overflow-hidden px-2 py-4">
        <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Main container */}
          <div className="flex flex-1 flex-col gap-3">
            {/* Top row: Active Model and Holo 1.5-7B side by side */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-2 py-1.5 dark:border-border/60 dark:bg-muted">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Model
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-foreground">
                    {modelIdentifier || "Model unavailable"}
                  </span>
                  {directVisionMode && (
                    <span className="inline-flex items-center rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-medium text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20">
                      Direct Vision
                    </span>
                  )}
                </div>
                {modelNameDetails && (
                  <span className="text-[9px] text-muted-foreground">
                    ID: {modelNameDetails}
                  </span>
                )}
              </div>
              <CVActivityIndicator directVisionMode={directVisionMode} />
            </div>
            <DesktopContainer
              className="max-h-[calc(100vh-12rem)]"
              screenshot={taskInactive ? currentScreenshot : null}
              viewOnly={vncViewOnly()}
              status={
                (() => {
                  if (
                    taskStatus === TaskStatus.RUNNING &&
                    control === Role.USER
                  )
                    return "user_control";
                  if (taskStatus === TaskStatus.RUNNING) return "running";
                  if (taskStatus === TaskStatus.NEEDS_HELP)
                    return "needs_attention";
                  if (taskStatus === TaskStatus.FAILED) return "failed";
                  if (taskStatus === TaskStatus.CANCELLED) return "canceled";
                  if (taskStatus === TaskStatus.COMPLETED) return "completed";
                  // You may want to add a scheduled state if you have that info
                  return "pending";
                })() as VirtualDesktopStatus
              }
            >
              {canTakeOver() && (
                <Button
                  onClick={handleTakeOverTask}
                  variant="default"
                  size="sm"
                  icon={
                    <HugeiconsIcon
                      icon={WavingHand01Icon}
                      className="h-5 w-5"
                    />
                  }
                >
                  Take Over
                </Button>
              )}
              {hasUserControl() && (
                <Button onClick={handleResumeTask} variant="default" size="sm">
                  Proceed
                </Button>
              )}
              {canCancel() && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <HugeiconsIcon
                        icon={MoreVerticalCircle01Icon}
                        className="text-bytebot-bronze-light-11 h-5 w-5"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleCancelTask}
                      className="text-red-600 focus:bg-red-50"
                    >
                      Cancel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </DesktopContainer>
          </div>

          {/* Chat Area + Telemetry */}
          <div className="flex h-full min-h-0 flex-col gap-3">
            {initialPrompt?.textBlocks.length ? (
              <div className="px-4">
                <TaskPromptSummary textBlocks={initialPrompt.textBlocks} />
              </div>
            ) : null}

            {/* Phase 4 UI: Progress Indicator for running tasks */}
            {taskStatus === TaskStatus.RUNNING && (
              <div className="px-4">
                <ProgressIndicator createdAt={createdAt || undefined} />
              </div>
            )}

            {/* Phase 4 UI: Re-failure Warning */}
            {needsHelpCount > 1 && (
              <div className="px-4">
                <ReFailureWarning
                  count={needsHelpCount}
                  modelName={taskModel?.name}
                />
              </div>
            )}

            {/* Phase 4 UI: Help Context Card */}
            {taskStatus === TaskStatus.NEEDS_HELP && helpContext && (
              <div className="px-4">
                <HelpContextCard helpContext={helpContext} />
              </div>
            )}

            {/* Telemetry sidebar */}
            <TelemetryStatus className="px-4" />
            {/* Messages scrollable area */}
            <div
              ref={chatContainerRef}
              className="hide-scrollbar min-h-0 flex-1 overflow-scroll px-4"
            >
              <ChatContainer
                scrollRef={chatContainerRef}
                messageIdToIndex={messageIdToIndex}
                taskId={taskId}
                input={input}
                setInput={setInput}
                isLoading={isLoading}
                handleAddMessage={handleAddMessage}
                groupedMessages={groupedMessages}
                taskStatus={taskStatus}
                control={control}
                isLoadingSession={isLoadingSession}
                isLoadingMoreMessages={isLoadingMoreMessages}
                hasMoreMessages={hasMoreMessages}
                loadMoreMessages={loadMoreMessages}
                directVisionMode={directVisionMode}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
