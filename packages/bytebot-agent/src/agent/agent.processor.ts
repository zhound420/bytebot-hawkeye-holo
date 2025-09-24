import { TasksService } from '../tasks/tasks.service';
import { MessagesService } from '../messages/messages.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  Message,
  Role,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { AnthropicService } from '../anthropic/anthropic.service';
import {
  isComputerToolUseContentBlock,
  isSetTaskStatusToolUseBlock,
  isCreateTaskToolUseBlock,
  isScreenshotToolUseBlock,
  isScreenshotRegionToolUseBlock,
  isScreenshotCustomRegionToolUseBlock,
  isComputerDetectElementsToolUseBlock,
  isComputerClickElementToolUseBlock,
  SetTaskStatusToolUseBlock,
} from '@bytebot/shared';

import {
  MessageContentBlock,
  MessageContentType,
  ToolResultContentBlock,
  TextContentBlock,
  ComputerDetectElementsToolUseBlock,
  ComputerClickElementToolUseBlock,
  Coordinates,
} from '@bytebot/shared';
import {
  ElementDetectorService,
  DetectedElement,
  BoundingBox,
  ClickTarget,
} from '@bytebot/cv';
import { InputCaptureService } from './input-capture.service';
import { OnEvent } from '@nestjs/event-emitter';
import { OpenAIService } from '../openai/openai.service';
import { GoogleService } from '../google/google.service';
import {
  BytebotAgentModel,
  BytebotAgentService,
  BytebotAgentResponse,
} from './agent.types';
import {
  buildAgentSystemPrompt,
  SCREENSHOT_OBSERVATION_GUARD_MESSAGE,
  SUMMARIZATION_SYSTEM_PROMPT,
} from './agent.constants';
import { SummariesService } from '../summaries/summaries.service';
import { handleComputerToolUse } from './agent.computer-use';
import { ProxyService } from '../proxy/proxy.service';

type CachedDetectedElement = {
  element: DetectedElement;
  timestamp: number;
  taskId: string | null;
};

@Injectable()
export class AgentProcessor {
  private readonly logger = new Logger(AgentProcessor.name);
  private currentTaskId: string | null = null;
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private services: Record<string, BytebotAgentService> = {};
  private pendingScreenshotObservation = false;
  private readonly elementDetector = new ElementDetectorService();
  private readonly elementCache = new Map<string, CachedDetectedElement>();
  private readonly elementCacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly tasksService: TasksService,
    private readonly messagesService: MessagesService,
    private readonly summariesService: SummariesService,
    private readonly anthropicService: AnthropicService,
    private readonly openaiService: OpenAIService,
    private readonly googleService: GoogleService,
    private readonly proxyService: ProxyService,
    private readonly inputCaptureService: InputCaptureService,
  ) {
    this.services = {
      anthropic: this.anthropicService,
      openai: this.openaiService,
      google: this.googleService,
      proxy: this.proxyService,
    };
    this.logger.log('AgentProcessor initialized');
  }

  /**
   * Check if the processor is currently processing a task
   */
  isRunning(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the current task ID being processed
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  @OnEvent('task.takeover')
  handleTaskTakeover({ taskId }: { taskId: string }) {
    this.logger.log(`Task takeover event received for task ID: ${taskId}`);

    // If the agent is still processing this task, abort any in-flight operations
    if (this.currentTaskId === taskId && this.isProcessing) {
      this.abortController?.abort();
    }

    // Always start capturing user input so that emitted actions are received
    this.inputCaptureService.start(taskId);
  }

  @OnEvent('task.resume')
  handleTaskResume({ taskId }: { taskId: string }) {
    if (this.currentTaskId === taskId && this.isProcessing) {
      this.logger.log(`Task resume event received for task ID: ${taskId}`);
      this.abortController = new AbortController();

      void this.runIteration(taskId);
    }
  }

  @OnEvent('task.cancel')
  async handleTaskCancel({ taskId }: { taskId: string }) {
    this.logger.log(`Task cancel event received for task ID: ${taskId}`);

    if (this.currentTaskId !== taskId) {
      this.logger.log(
        `Ignoring cancel event for task ID: ${taskId} because current task is ${this.currentTaskId}`,
      );
      return;
    }

    await this.stopProcessing();
  }

  processTask(taskId: string) {
    this.logger.log(`Starting processing for task ID: ${taskId}`);

    if (this.isProcessing) {
      this.logger.warn('AgentProcessor is already processing another task');
      return;
    }

    this.isProcessing = true;
    this.currentTaskId = taskId;
    this.abortController = new AbortController();
    this.pendingScreenshotObservation = false;

    // Kick off the first iteration without blocking the caller
    void this.runIteration(taskId);
  }

  /**
   * Runs a single iteration of task processing and schedules the next
   * iteration via setImmediate while the task remains RUNNING.
   */
  private async runIteration(taskId: string): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    try {
      const task: Task = await this.tasksService.findById(taskId);

      if (task.status !== TaskStatus.RUNNING) {
        this.logger.log(
          `Task processing completed for task ID: ${taskId} with status: ${task.status}`,
        );
        this.isProcessing = false;
        this.currentTaskId = null;
        return;
      }

      this.logger.log(`Processing iteration for task ID: ${taskId}`);

      // Refresh abort controller for this iteration to avoid accumulating
      // "abort" listeners on a single AbortSignal across iterations.
      this.abortController = new AbortController();

      const latestSummary = await this.summariesService.findLatest(taskId);
      const unsummarizedMessages =
        await this.messagesService.findUnsummarized(taskId);
      const messages = [
        ...(latestSummary
          ? [
              {
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                taskId,
                summaryId: null,
                role: Role.USER,
                content: [
                  {
                    type: MessageContentType.Text,
                    text: latestSummary.content,
                  },
                ],
              },
            ]
          : []),
        ...unsummarizedMessages,
      ];
      this.logger.debug(
        `Sending ${messages.length} messages to LLM for processing`,
      );

      const model = task.model as unknown as BytebotAgentModel;
      let agentResponse: BytebotAgentResponse;

      const service = this.services[model.provider];
      if (!service) {
        this.logger.warn(
          `No service found for model provider: ${model.provider}`,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        this.isProcessing = false;
        this.currentTaskId = null;
        return;
      }

      agentResponse = await service.generateMessage(
        buildAgentSystemPrompt(),
        messages,
        model.name,
        true,
        this.abortController.signal,
      );

      const messageContentBlocks = agentResponse.contentBlocks;

      this.logger.debug(
        `Received ${messageContentBlocks.length} content blocks from LLM`,
      );

      if (messageContentBlocks.length === 0) {
        this.logger.warn(
          `Task ID: ${taskId} received no content blocks from LLM, marking as failed`,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        this.isProcessing = false;
        this.currentTaskId = null;
        return;
      }

      await this.messagesService.create({
        content: messageContentBlocks,
        role: Role.ASSISTANT,
        taskId,
      });

      // Calculate if we need to summarize based on token usage
      const contextWindow = model.contextWindow || 200000; // Default to 200k if not specified
      const contextThreshold = contextWindow * 0.75;
      const shouldSummarize =
        agentResponse.tokenUsage.totalTokens >= contextThreshold;

      if (shouldSummarize) {
        try {
          // After we've successfully generated a response, we can summarize the unsummarized messages
          const summaryResponse = await service.generateMessage(
            SUMMARIZATION_SYSTEM_PROMPT,
            [
              ...messages,
              {
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                taskId,
                summaryId: null,
                role: Role.USER,
                content: [
                  {
                    type: MessageContentType.Text,
                    text: 'Respond with a summary of the messages above. Do not include any additional information.',
                  },
                ],
              },
            ],
            model.name,
            false,
            this.abortController.signal,
          );

          const summaryContentBlocks = summaryResponse.contentBlocks;

          this.logger.debug(
            `Received ${summaryContentBlocks.length} summary content blocks from LLM`,
          );
          const summaryContent = summaryContentBlocks
            .filter(
              (block: MessageContentBlock) =>
                block.type === MessageContentType.Text,
            )
            .map((block: TextContentBlock) => block.text)
            .join('\n');

          const summary = await this.summariesService.create({
            content: summaryContent,
            taskId,
          });

          await this.messagesService.attachSummary(taskId, summary.id, [
            ...messages.map((message) => {
              return message.id;
            }),
          ]);

          this.logger.log(
            `Generated summary for task ${taskId} due to token usage (${agentResponse.tokenUsage.totalTokens}/${contextWindow})`,
          );
        } catch (error: any) {
          this.logger.error(
            `Error summarizing messages for task ID: ${taskId}`,
            error.stack,
          );
        }
      }

      this.logger.debug(
        `Token usage for task ${taskId}: ${agentResponse.tokenUsage.totalTokens}/${contextWindow} (${Math.round((agentResponse.tokenUsage.totalTokens / contextWindow) * 100)}%)`,
      );

      const generatedToolResults: ToolResultContentBlock[] = [];

      let mustClearObservationThisReply = this.pendingScreenshotObservation;
      let observationBlockedInReply = false;

      let setTaskStatusToolUseBlock: SetTaskStatusToolUseBlock | null = null;

      for (const block of messageContentBlocks) {
        if (
          this.pendingScreenshotObservation &&
          mustClearObservationThisReply
        ) {
          if (block.type === MessageContentType.Text) {
            const textBlock = block as TextContentBlock;
            const text = (textBlock.text || '').trim();
            if (text.length > 0 && !observationBlockedInReply) {
              this.pendingScreenshotObservation = false;
              mustClearObservationThisReply = false;
            }
          } else if (isComputerToolUseContentBlock(block)) {
            observationBlockedInReply = true;
            generatedToolResults.push({
              type: MessageContentType.ToolResult,
              tool_use_id: block.id,
              is_error: true,
              content: [
                {
                  type: MessageContentType.Text,
                  text: SCREENSHOT_OBSERVATION_GUARD_MESSAGE,
                },
              ],
            });
            continue;
          }
        }

        if (isComputerToolUseContentBlock(block)) {
          if (isComputerDetectElementsToolUseBlock(block)) {
            const result = await this.handleComputerDetectElements(block);
            generatedToolResults.push(result);
            continue;
          }

          if (isComputerClickElementToolUseBlock(block)) {
            const result = await this.handleComputerClickElement(block);
            generatedToolResults.push(result);
            continue;
          }

          const result = await handleComputerToolUse(block, this.logger);
          generatedToolResults.push(result);

          if (
            isScreenshotToolUseBlock(block) ||
            isScreenshotRegionToolUseBlock(block) ||
            isScreenshotCustomRegionToolUseBlock(block)
          ) {
            this.pendingScreenshotObservation = true;
            mustClearObservationThisReply = true;
            observationBlockedInReply = false;
          }
        }

        if (isCreateTaskToolUseBlock(block)) {
          const type = block.input.type?.toUpperCase() as TaskType;
          const priority = block.input.priority?.toUpperCase() as TaskPriority;

          await this.tasksService.create({
            description: block.input.description,
            type,
            createdBy: Role.ASSISTANT,
            ...(block.input.scheduledFor && {
              scheduledFor: new Date(block.input.scheduledFor),
            }),
            model: task.model,
            priority,
          });

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: 'The task has been created',
              },
            ],
          });
        }

        if (isSetTaskStatusToolUseBlock(block)) {
          setTaskStatusToolUseBlock = block;

          generatedToolResults.push({
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            is_error: block.input.status === 'failed',
            content: [
              {
                type: MessageContentType.Text,
                text: block.input.description,
              },
            ],
          });
        }
      }

      if (generatedToolResults.length > 0) {
        await this.messagesService.create({
          content: generatedToolResults,
          role: Role.USER,
          taskId,
        });
      }

      // Update the task status after all tool results have been generated if we have a set task status tool use block
      if (setTaskStatusToolUseBlock) {
        const desired = setTaskStatusToolUseBlock.input.status;
        if (desired === 'completed') {
          const canComplete = await this.canMarkCompleted(taskId);
          if (canComplete) {
            await this.tasksService.update(taskId, {
              status: TaskStatus.COMPLETED,
              completedAt: new Date(),
            });
          } else {
            // Reject completion with guidance; keep task running
            await this.messagesService.create({
              content: [
                {
                  type: MessageContentType.ToolResult,
                  tool_use_id: setTaskStatusToolUseBlock.id,
                  is_error: true,
                  content: [
                    {
                      type: MessageContentType.Text,
                      text: 'Cannot mark as completed yet. Please perform concrete actions (e.g., open the app, click/type/paste, write_file) and provide verification (screenshot of the result or computer_read_file content). Then try completion again.',
                    },
                  ],
                } as any,
              ],
              role: Role.ASSISTANT,
              taskId,
            });
          }
        } else if (desired === 'needs_help') {
          await this.tasksService.update(taskId, {
            status: TaskStatus.NEEDS_HELP,
          });
        } else if (desired === 'failed') {
          const failureTimestamp = new Date();
          const failureReason =
            setTaskStatusToolUseBlock.input.description ??
            'no description provided';
          this.logger.warn(
            `Task ${taskId} marked as failed via set_task_status tool: ${failureReason}`,
          );
          await this.tasksService.update(taskId, {
            status: TaskStatus.FAILED,
            completedAt: failureTimestamp,
            executedAt: task.executedAt ?? failureTimestamp,
          });
        }
      }

      // Schedule the next iteration without blocking
      if (this.isProcessing) {
        setImmediate(() => this.runIteration(taskId));
      }
    } catch (error: any) {
      if (error?.name === 'BytebotAgentInterrupt') {
        this.logger.warn(`Processing aborted for task ID: ${taskId}`);
      } else {
        this.logger.error(
          `Error during task processing iteration for task ID: ${taskId} - ${error.message}`,
          error.stack,
        );
        await this.tasksService.update(taskId, {
          status: TaskStatus.FAILED,
        });
        this.isProcessing = false;
        this.currentTaskId = null;
      }
    }
  }

  private async handleComputerDetectElements(
    block: ComputerDetectElementsToolUseBlock,
  ): Promise<ToolResultContentBlock> {
    try {
      const screenshotBuffer = await this.captureScreenshotBuffer();
      const description = block.input.description.trim();
      const includeAll = block.input.includeAll ?? false;
      const searchRegion = block.input.region
        ? this.normalizeRegion(block.input.region)
        : undefined;

      const detectionConfig = {
        enableOCR: true,
        enableTemplateMatching: true,
        enableEdgeDetection: true,
        confidenceThreshold: 0.5,
        ...(searchRegion ? { searchRegion } : {}),
      };

      let detectedElements = await this.elementDetector.detectElements(
        screenshotBuffer,
        detectionConfig,
      );

      if (searchRegion) {
        detectedElements = this.filterElementsByRegion(
          detectedElements,
          searchRegion,
        );
      }

      let selectedElements: DetectedElement[];
      if (includeAll) {
        selectedElements = detectedElements;
      } else {
        const matches: DetectedElement[] = [];
        for (const element of detectedElements) {
          const match = await this.elementDetector.findElementByDescription(
            [element],
            description,
          );
          if (match) {
            matches.push(match);
          }
        }

        if (matches.length > 0) {
          selectedElements = matches.slice(0, 10);
        } else {
          selectedElements = detectedElements.slice(
            0,
            Math.min(5, detectedElements.length),
          );
        }
      }

      this.cacheDetectedElements(selectedElements);

      const summary = {
        description,
        includeAll,
        totalDetected: detectedElements.length,
        returned: selectedElements.length,
        elements: selectedElements.map((element) => ({
          id: element.id,
          type: element.type,
          text: element.text ?? null,
          confidence: Number(element.confidence.toFixed(3)),
          coordinates: element.coordinates,
          detectionMethod: element.metadata.detectionMethod,
        })),
      };

      const content: MessageContentBlock[] = [];
      if (selectedElements.length === 0) {
        content.push({
          type: MessageContentType.Text,
          text:
            detectedElements.length === 0
              ? `No UI elements detected for description "${description}".`
              : `No elements matched description "${description}". ${detectedElements.length} element(s) detected overall.`,
        });
      } else {
        content.push({
          type: MessageContentType.Text,
          text: `Detected ${selectedElements.length} element(s) for "${description}" out of ${detectedElements.length} total. Use these element_id values for computer_click_element.`,
        });
      }

      content.push({
        type: MessageContentType.Text,
        text: `Detection payload: ${JSON.stringify(summary, null, 2)}`,
      });

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: `Element detection failed: ${message}`,
          },
        ],
        is_error: true,
      };
    }
  }

  private async handleComputerClickElement(
    block: ComputerClickElementToolUseBlock,
  ): Promise<ToolResultContentBlock> {
    const { element_id: elementId, fallback_coordinates: fallbackCoordinates } =
      block.input;

    const attempts: Array<{
      coordinates: Coordinates;
      origin: string;
      success: boolean;
    }> = [];

    try {
      const cached = this.getElementFromCache(elementId);
      let element: DetectedElement | null = null;

      if (cached) {
        element = cached.element;
      }

      if (!element) {
        if (fallbackCoordinates) {
          const fallbackSuccess =
            await this.attemptClickAt(fallbackCoordinates);
          attempts.push({
            coordinates: fallbackCoordinates,
            origin: 'input_fallback',
            success: fallbackSuccess,
          });

          return {
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: fallbackSuccess
                  ? `Element ${elementId} not cached; clicked provided fallback coordinates (${fallbackCoordinates.x}, ${fallbackCoordinates.y}).`
                  : `Element ${elementId} not cached and fallback coordinates failed to click.`,
              },
              {
                type: MessageContentType.Text,
                text: `Click attempts: ${JSON.stringify(attempts, null, 2)}`,
              },
            ],
            is_error: !fallbackSuccess,
          };
        }

        throw new Error(
          `Element with ID ${elementId} not found. Run computer_detect_elements first.`,
        );
      }

      const clickTarget: ClickTarget =
        await this.elementDetector.getClickCoordinates(element);
      const queue: Array<{ coordinates: Coordinates; origin: string }> = [];
      queue.push({ coordinates: clickTarget.coordinates, origin: 'primary' });

      for (const coords of clickTarget.fallbackCoordinates ?? []) {
        queue.push({ coordinates: coords, origin: 'detector_fallback' });
      }

      if (fallbackCoordinates) {
        queue.push({
          coordinates: fallbackCoordinates,
          origin: 'input_fallback',
        });
      }

      let successfulCoordinates: Coordinates | null = null;

      for (const attempt of queue) {
        const success = await this.attemptClickAt(attempt.coordinates);
        attempts.push({
          coordinates: attempt.coordinates,
          origin: attempt.origin,
          success,
        });

        if (success) {
          successfulCoordinates = attempt.coordinates;
          break;
        }
      }

      const summary = {
        elementId,
        detectionMethod: element.metadata.detectionMethod,
        confidence: element.confidence,
        attempts,
        selectedCoordinates: successfulCoordinates,
      };

      const content: MessageContentBlock[] = [
        {
          type: MessageContentType.Text,
          text: successfulCoordinates
            ? `Clicked element ${elementId} at (${successfulCoordinates.x}, ${successfulCoordinates.y}) using ${summary.detectionMethod} detection.`
            : `Failed to click element ${elementId} after ${attempts.length} attempt(s).`,
        },
        {
          type: MessageContentType.Text,
          text: `Click summary: ${JSON.stringify(summary, null, 2)}`,
        },
      ];

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content,
        is_error: !successfulCoordinates,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: `Click element failed: ${message}`,
          },
          {
            type: MessageContentType.Text,
            text: `Click attempts: ${JSON.stringify(attempts, null, 2)}`,
          },
        ],
        is_error: true,
      };
    }
  }

  private async captureScreenshotBuffer(): Promise<Buffer> {
    const baseUrl = this.getDesktopBaseUrl();
    const response = await fetch(`${baseUrl}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot',
        showCursor: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to take screenshot: ${response.statusText}`);
    }

    const payload = (await response.json()) as { image?: string };
    if (!payload.image) {
      throw new Error('Screenshot response did not include image data');
    }

    return Buffer.from(payload.image, 'base64');
  }

  private normalizeRegion(region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): BoundingBox {
    return {
      ...region,
      centerX: region.x + region.width / 2,
      centerY: region.y + region.height / 2,
    };
  }

  private filterElementsByRegion(
    elements: DetectedElement[],
    region: BoundingBox,
  ): DetectedElement[] {
    return elements.filter((element) =>
      this.boxesOverlap(element.coordinates, region),
    );
  }

  private boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
    const horizontalOverlap =
      Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width);
    const verticalOverlap =
      Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height);
    return horizontalOverlap && verticalOverlap;
  }

  private cacheDetectedElements(elements: DetectedElement[]): void {
    this.pruneElementCache();

    const timestamp = Date.now();
    for (const element of elements) {
      this.elementCache.set(element.id, {
        element,
        timestamp,
        taskId: this.currentTaskId,
      });
    }
  }

  private getElementFromCache(elementId: string): CachedDetectedElement | null {
    this.pruneElementCache();

    const cached = this.elementCache.get(elementId);
    if (!cached) {
      return null;
    }

    if (cached.taskId && cached.taskId !== this.currentTaskId) {
      return null;
    }

    cached.timestamp = Date.now();
    return cached;
  }

  private pruneElementCache(): void {
    const now = Date.now();
    for (const [id, cached] of this.elementCache.entries()) {
      if (
        now - cached.timestamp > this.elementCacheTtlMs ||
        (cached.taskId && cached.taskId !== this.currentTaskId)
      ) {
        this.elementCache.delete(id);
      }
    }
  }

  private async attemptClickAt(coordinates: Coordinates): Promise<boolean> {
    const baseUrl = this.getDesktopBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'click_mouse',
          coordinates,
          button: 'left',
          clickCount: 1,
        }),
      });

      if (!response.ok) {
        return false;
      }

      try {
        const payload = (await response.json()) as { success?: boolean };
        if (typeof payload.success === 'boolean') {
          return payload.success;
        }
      } catch {
        // Ignore JSON parsing errors; fall back to assuming success when HTTP 200
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Click request failed at (${coordinates.x}, ${coordinates.y}): ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }

  private getDesktopBaseUrl(): string {
    const baseUrl = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!baseUrl) {
      throw new Error('BYTEBOT_DESKTOP_BASE_URL is not configured');
    }
    return baseUrl;
  }

  /**
   * Basic completion gate: ensure at least one meaningful action occurred
   * (click/type/paste/press_keys/drag/application/write/read_file), optionally
   * with verification (document or screenshot present in history).
   */
  private async canMarkCompleted(taskId: string): Promise<boolean> {
    try {
      const history = await this.messagesService.findEvery(taskId);
      let hasAction = false;
      let hasFreshVerification = false;
      let latestActionPosition: {
        messageIndex: number;
        blockIndex: number;
      } | null = null;

      const ACTION_NAMES = new Set<string>([
        'computer_click_mouse',
        'computer_click_element',
        'computer_type_text',
        'computer_paste_text',
        'computer_press_keys',
        'computer_drag_mouse',
        'computer_application',
        'computer_write_file',
        'computer_read_file',
      ]);

      history.forEach((msg, messageIndex) => {
        const blocks = (msg.content as MessageContentBlock[]) || [];
        blocks.forEach((block, blockIndex) => {
          if (block.type === MessageContentType.ToolUse) {
            const name = (block as any).name as string;
            if (ACTION_NAMES.has(name)) {
              hasAction = true;
              hasFreshVerification = false;
              latestActionPosition = { messageIndex, blockIndex };
            }
          }
          if (block.type === MessageContentType.ToolResult) {
            const tr = block as any;
            // Evidence: any document result or any image result
            const content = (tr.content || []) as any[];
            const hasVerificationContent = content.some((c) =>
              [MessageContentType.Document, MessageContentType.Image].includes(
                c.type as MessageContentType,
              ),
            );
            if (
              hasVerificationContent &&
              latestActionPosition &&
              (messageIndex > latestActionPosition.messageIndex ||
                (messageIndex === latestActionPosition.messageIndex &&
                  blockIndex > latestActionPosition.blockIndex))
            ) {
              hasFreshVerification = true;
            }
          }
        });
      });

      // Minimal requirement: at least one action and some verification artifact
      return hasAction && hasFreshVerification;
    } catch (e) {
      this.logger.warn(
        `canMarkCompleted: fallback to allow completion due to error: ${(e as Error).message}`,
      );
      return true;
    }
  }

  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }

    this.logger.log(`Stopping execution of task ${this.currentTaskId}`);

    // Signal any in-flight async operations to abort
    this.abortController?.abort();

    await this.inputCaptureService.stop();

    this.isProcessing = false;
    this.currentTaskId = null;
    this.pendingScreenshotObservation = false;
    this.elementCache.clear();
  }
}
