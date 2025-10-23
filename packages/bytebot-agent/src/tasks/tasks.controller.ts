import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpStatus,
  HttpCode,
  Query,
  HttpException,
  Logger,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskOutcomeService } from './task-outcome.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { Message, Task } from '@prisma/client';
import { AddTaskMessageDto } from './dto/add-task-message.dto';
import { MessagesService } from '../messages/messages.service';
import { ANTHROPIC_MODELS } from '../anthropic/anthropic.constants';
import { OPENAI_MODELS } from '../openai/openai.constants';
import { GOOGLE_MODELS } from '../google/google.constants';
import { BytebotAgentModel } from 'src/agent/agent.types';
import { OpenAIService } from '../openai/openai.service';

type AgentTelemetrySessionInfo = {
  id: string;
  label: string;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  eventCount?: number;
  sessionStart: string | null;
  sessionEnd: string | null;
  sessionDurationMs: number | null;
};

/**
 * Get fallback model list based on current API key availability
 * Called fresh each time to ensure API keys are checked dynamically
 */
function getFallbackModels(): BytebotAgentModel[] {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  return [
    ...(anthropicApiKey ? ANTHROPIC_MODELS : []),
    ...(openaiApiKey ? OPENAI_MODELS : []),
    ...(geminiApiKey ? GOOGLE_MODELS : []),
  ];
}

@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly messagesService: MessagesService,
    private readonly taskOutcomeService: TaskOutcomeService,
    private readonly openaiService: OpenAIService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTaskDto: CreateTaskDto): Promise<Task> {
    return this.tasksService.create(createTaskDto);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('statuses') statuses?: string,
  ): Promise<{ tasks: Task[]; total: number; totalPages: number }> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Handle both single status and multiple statuses
    let statusFilter: string[] | undefined;
    if (statuses) {
      statusFilter = statuses.split(',');
    } else if (status) {
      statusFilter = [status];
    }

    return this.tasksService.findAll(pageNum, limitNum, statusFilter);
  }

  @Get('models')
  async getModels() {
    const allModels: BytebotAgentModel[] = [];

    // Check API key availability dynamically (not at module load time)
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // 1. Try LiteLLM proxy first (includes LMStudio and other proxy models)
    const proxyUrl = process.env.BYTEBOT_LLM_PROXY_URL;
    if (proxyUrl) {
      try {
        const response = await fetch(`${proxyUrl}/model/info`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new HttpException(
            `Failed to fetch models from proxy: ${response.statusText}`,
            HttpStatus.BAD_GATEWAY,
          );
        }

        const proxyModels = await response.json();
        const proxyModelList = Array.isArray(proxyModels?.model_list)
          ? proxyModels.model_list
          : Array.isArray(proxyModels?.data)
            ? proxyModels.data
            : null;

        if (!proxyModelList) {
          throw new HttpException(
            'Proxy response did not include a model_list or data array',
            HttpStatus.BAD_GATEWAY,
          );
        }

        // Map proxy response to BytebotAgentModel format
        const models: BytebotAgentModel[] = proxyModelList.map((model: any) => {
          // Prioritize explicit false values (user overrides in litellm-config.yaml)
          // This ensures model_info.supports_vision: false always wins
          const explicitlyDisabled =
            model.model_info?.supports_vision === false ||
            model.litellm_params?.supports_vision === false ||
            model.supports_vision === false;

          let supportsVision: boolean;
          if (explicitlyDisabled) {
            supportsVision = false;
          } else {
            // Check if any field explicitly enables vision
            supportsVision =
              model.supports_vision === true ||
              model.model_info?.supports_vision === true ||
              model.litellm_params?.supports_vision === true ||
              model.litellm_params?.supports_image_input === true;
          }

          // Debug logging for vision capability detection
          this.logger.debug(
            `Model ${model.model_name}: ` +
            `supports_vision=${model.supports_vision}, ` +
            `model_info.supports_vision=${model.model_info?.supports_vision}, ` +
            `litellm_params.supports_vision=${model.litellm_params?.supports_vision}, ` +
            `litellm_params.supports_image_input=${model.litellm_params?.supports_image_input} ` +
            `→ supportsVision=${supportsVision}`
          );

          // Extract LiteLLM metadata for advanced routing
          const modelName = model.litellm_params.model.toLowerCase();
          const inputCost = model.model_info?.input_cost_per_token;
          const outputCost = model.model_info?.output_cost_per_token;
          const maxTokens = model.model_info?.max_output_tokens || model.max_tokens;
          const contextWindow = model.model_info?.max_input_tokens || 128000;

          // Detect provider from api_base or model name
          let provider: BytebotAgentModel['provider'] = 'proxy';
          const apiBase = model.litellm_params?.api_base?.toLowerCase() || '';
          const baseModel = model.model_info?.base_model?.toLowerCase() || '';

          // Detect LMStudio (local models) and OpenRouter - these need special routing
          // All other models from LiteLLM proxy will keep provider = 'proxy' for correct routing
          if (baseModel === 'lmstudio' || apiBase.includes('lmstudio') || model.model_name?.startsWith('local-')) {
            provider = 'lmstudio';
          }
          else if (modelName.includes('openrouter/') || apiBase.includes('openrouter.ai')) {
            provider = 'openrouter';
          }
          // All Anthropic, OpenAI, Google models from LiteLLM stay as provider='proxy'
          // This ensures they are routed to ProxyService, not direct provider services

          // Detect advanced feature support
          const supportsPromptCaching = modelName.includes('anthropic/claude');

          // Reasoning effort support - check metadata from litellm-config.yaml
          // Can be set via: litellm_params.supports_reasoning_effort: true
          // or model_info.supports_reasoning_effort: true
          const supportsReasoningEffort =
            model.litellm_params?.supports_reasoning_effort === true ||
            model.model_info?.supports_reasoning_effort === true;

          // Extract function calling support from litellm config
          const supportsToolCalling =
            model.litellm_params?.supports_function_calling ??
            model.model_info?.supports_function_calling ??
            true; // Default to true for unknown models

          return {
            provider,
            name: model.model_name,
            title: model.model_name,
            contextWindow,
            supportsVision,
            supportsToolCalling,
            inputCost,
            outputCost,
            maxTokens,
            supportsPromptCaching,
            supportsReasoningEffort,
          } satisfies BytebotAgentModel;
        });

        allModels.push(...models);
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        this.logger.warn(`Proxy models unavailable: ${error.message}`);
        // Continue to fetch from direct APIs
      }
    }

    // 2. Fetch OpenAI models dynamically (if API key set)
    // Add direct OpenAI models if API key is set, regardless of proxy URL
    if (openaiApiKey) {
      try {
        const openaiModels = await this.openaiService.listModels();
        allModels.push(...openaiModels);
        this.logger.log(`Fetched ${openaiModels.length} OpenAI models dynamically (direct API)`);
      } catch (error) {
        this.logger.warn(`OpenAI models unavailable: ${error.message}`);
        // Fallback to hardcoded list
        allModels.push(...OPENAI_MODELS);
      }
    }

    // 3. Add Anthropic models (hardcoded, curated list - no dynamic API available)
    // Add direct Anthropic models if API key is set, regardless of proxy URL
    // This allows both direct API (AnthropicService) and proxy (LiteLLM) paths to work
    if (anthropicApiKey) {
      allModels.push(...ANTHROPIC_MODELS);
      this.logger.log(`Added ${ANTHROPIC_MODELS.length} Anthropic models from curated list (direct API)`);
    }

    // 4. Add Google Gemini models (hardcoded - could add dynamic fetching later)
    // Add direct Google models if API key is set, regardless of proxy URL
    if (geminiApiKey) {
      allModels.push(...GOOGLE_MODELS);
      this.logger.log(`Added ${GOOGLE_MODELS.length} Google models from curated list (direct API)`);
    }

    // If no models found at all, return fallback hardcoded lists
    if (allModels.length === 0) {
      this.logger.warn('No models available from any source, using fallback lists');
      return getFallbackModels(); // Return dynamically evaluated fallback based on current API keys
    }

    return allModels;
  }

  @Get('telemetry/summary')
  async telemetrySummary(
    @Query('app') app?: string,
    @Query('limit') limit?: string,
    @Query('session') session?: string,
  ) {
    const base = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!base) {
      throw new HttpException(
        'Desktop base URL not configured',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const qs: string[] = [];
    if (app) qs.push(`app=${encodeURIComponent(app)}`);
    if (limit) qs.push(`limit=${encodeURIComponent(limit)}`);
    if (session) qs.push(`session=${encodeURIComponent(session)}`);
    const url = `${base}/telemetry/summary${qs.length ? `?${qs.join('&')}` : ''}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(
          `Failed to fetch telemetry: ${res.statusText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return await res.json();
    } catch (e: any) {
      throw new HttpException(
        `Error fetching telemetry: ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('telemetry/apps')
  async telemetryApps(
    @Query('limit') limit?: string,
    @Query('window') window?: string,
    @Query('session') session?: string,
  ) {
    const base = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!base) {
      throw new HttpException(
        'Desktop base URL not configured',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const qs: string[] = [];
    if (limit) qs.push(`limit=${encodeURIComponent(limit)}`);
    if (window) qs.push(`window=${encodeURIComponent(window)}`);
    if (session) qs.push(`session=${encodeURIComponent(session)}`);
    const url = `${base}/telemetry/apps${qs.length ? `?${qs.join('&')}` : ''}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(
          `Failed to fetch apps: ${res.statusText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return await res.json();
    } catch (e: any) {
      throw new HttpException(
        `Error fetching apps: ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('telemetry/reset')
  async telemetryReset(@Query('session') session?: string) {
    const base = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!base) {
      throw new HttpException(
        'Desktop base URL not configured',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const url = `${base}/telemetry/reset${
      session ? `?session=${encodeURIComponent(session)}` : ''
    }`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        throw new HttpException(
          `Failed to reset telemetry: ${res.statusText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return await res.json();
    } catch (e: any) {
      throw new HttpException(
        `Error resetting telemetry: ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private normalizeTelemetrySession(input: unknown): AgentTelemetrySessionInfo | null {
    if (!input || typeof input !== 'object') {
      if (typeof input === 'string' && input.trim().length > 0) {
        const id = input.trim();
        return {
          id,
          label: id,
          startedAt: null,
          endedAt: null,
          lastEventAt: null,
          sessionStart: null,
          sessionEnd: null,
          sessionDurationMs: null,
        };
      }
      return null;
    }

    const candidate = input as Record<string, unknown>;
    const idSource = candidate.id ?? candidate.sessionId ?? candidate.identifier;
    const id =
      typeof idSource === 'string' && idSource.trim().length > 0
        ? idSource.trim()
        : null;
    if (!id) {
      return null;
    }

    const label =
      typeof candidate.label === 'string' && candidate.label.trim().length > 0
        ? candidate.label
        : id;
    const startedAtCandidate =
      typeof candidate.startedAt === 'string' && candidate.startedAt.length > 0
        ? candidate.startedAt
        : null;
    const endedAtCandidate =
      typeof candidate.endedAt === 'string' && candidate.endedAt.length > 0
        ? candidate.endedAt
        : null;
    const sessionStart =
      typeof candidate.sessionStart === 'string' &&
      candidate.sessionStart.length > 0
        ? candidate.sessionStart
        : startedAtCandidate;
    const sessionEnd =
      typeof candidate.sessionEnd === 'string' &&
      candidate.sessionEnd.length > 0
        ? candidate.sessionEnd
        : endedAtCandidate;
    const lastEventAt =
      typeof candidate.lastEventAt === 'string' &&
      candidate.lastEventAt.length > 0
        ? candidate.lastEventAt
        : sessionEnd ?? endedAtCandidate ?? null;
    const eventCount =
      typeof candidate.eventCount === 'number' &&
      Number.isFinite(candidate.eventCount)
        ? candidate.eventCount
        : undefined;
    const sessionDurationMs =
      typeof candidate.sessionDurationMs === 'number' &&
      Number.isFinite(candidate.sessionDurationMs)
        ? candidate.sessionDurationMs
        : null;

    return {
      id,
      label,
      startedAt: sessionStart ?? startedAtCandidate,
      endedAt: sessionEnd ?? endedAtCandidate,
      lastEventAt,
      eventCount,
      sessionStart: sessionStart ?? null,
      sessionEnd: sessionEnd ?? null,
      sessionDurationMs,
    };
  }

  @Get('telemetry/sessions')
  async telemetrySessions(): Promise<{
    current: AgentTelemetrySessionInfo | null;
    sessions: AgentTelemetrySessionInfo[];
  }> {
    const base = process.env.BYTEBOT_DESKTOP_BASE_URL;
    if (!base) {
      throw new HttpException(
        'Desktop base URL not configured',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const url = `${base}/telemetry/sessions`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(
          `Failed to fetch sessions: ${res.statusText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      const payload = (await res.json()) as {
        current?: unknown;
        sessions?: unknown;
      };
      const normalizedSessions = Array.isArray(payload.sessions)
        ? payload.sessions
            .map((session) => this.normalizeTelemetrySession(session))
            .filter(
              (session): session is AgentTelemetrySessionInfo => session !== null,
            )
        : [];

      const sessionMap = new Map<string, AgentTelemetrySessionInfo>();
      for (const session of normalizedSessions) {
        sessionMap.set(session.id, session);
      }

      const currentCandidate = this.normalizeTelemetrySession(payload.current);
      let current: AgentTelemetrySessionInfo | null = null;
      if (currentCandidate) {
        const existing = sessionMap.get(currentCandidate.id);
        current = existing ?? currentCandidate;
        if (!existing) {
          sessionMap.set(currentCandidate.id, currentCandidate);
        }
      }

      const sessions: AgentTelemetrySessionInfo[] = [];
      const seen = new Set<string>();
      if (current) {
        sessions.push(current);
        seen.add(current.id);
      }
      for (const session of sessionMap.values()) {
        if (seen.has(session.id)) {
          continue;
        }
        sessions.push(session);
        seen.add(session.id);
      }

      return {
        current,
        sessions,
      };
    } catch (e: any) {
      throw new HttpException(
        `Error fetching sessions: ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // Model Performance Endpoints (Empirical Learning System)

  @Get('models/leaderboard')
  async getModelLeaderboard(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const leaderboard = await this.taskOutcomeService.getModelLeaderboard(limitNum);
    return {
      leaderboard,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('models/stats/:modelName')
  async getModelStats(@Param('modelName') modelName: string) {
    const stats = await this.taskOutcomeService.getModelPerformanceStats(modelName);

    if (!stats) {
      throw new HttpException(
        `No performance data available for model: ${modelName}`,
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      modelName,
      stats,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('models/recommend')
  async recommendModels(
    @Query('description') description?: string,
    @Query('complexity') complexity?: string,
  ) {
    if (!description || description.trim().length === 0) {
      throw new HttpException(
        'Task description is required for recommendations',
        HttpStatus.BAD_REQUEST,
      );
    }

    const recommendations = await this.taskOutcomeService.recommendModels(
      description,
      complexity,
    );

    return {
      description,
      complexity: complexity || 'any',
      recommendations,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('models/current-performance')
  async getCurrentModelPerformance(@Query('modelName') modelName?: string) {
    if (!modelName || modelName.trim().length === 0) {
      return {
        modelName: null,
        stats: null,
        message: 'No active model specified',
      };
    }

    const stats = await this.taskOutcomeService.getModelPerformanceStats(modelName);
    const successRate = await this.taskOutcomeService.getModelSuccessRate(modelName);

    return {
      modelName,
      stats,
      successRate,
      hasData: stats !== null,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Task> {
    return this.tasksService.findById(id);
  }

  @Get(':id/messages')
  async taskMessages(
    @Param('id') taskId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ): Promise<Message[]> {
    const options = {
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
    };

    const messages = await this.messagesService.findAll(taskId, options);
    return messages;
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  async addTaskMessage(
    @Param('id') taskId: string,
    @Body() guideTaskDto: AddTaskMessageDto,
  ): Promise<Task> {
    return this.tasksService.addTaskMessage(taskId, guideTaskDto);
  }

  @Get(':id/messages/raw')
  async taskRawMessages(
    @Param('id') taskId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ): Promise<Message[]> {
    const options = {
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
    };

    return this.messagesService.findRawMessages(taskId, options);
  }

  @Get(':id/messages/processed')
  async taskProcessedMessages(
    @Param('id') taskId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const options = {
      limit: limit ? parseInt(limit, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
    };

    return this.messagesService.findProcessedMessages(taskId, options);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.tasksService.delete(id);
  }

  @Post(':id/takeover')
  @HttpCode(HttpStatus.OK)
  async takeOver(@Param('id') taskId: string): Promise<Task> {
    return this.tasksService.takeOver(taskId);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('id') taskId: string): Promise<Task> {
    return this.tasksService.resume(taskId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') taskId: string): Promise<Task> {
    return this.tasksService.cancel(taskId);
  }
}
