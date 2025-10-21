import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIUserAbortError } from 'openai';
import {
  MessageContentBlock,
  MessageContentType,
  TextContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
  ThinkingContentBlock,
  isUserActionContentBlock,
  isComputerToolUseContentBlock,
  isImageContentBlock,
} from '@bytebot/shared';
import { DEFAULT_MODEL } from './openai.constants';
import { Message, Role } from '@prisma/client';
import { openaiTools, getOpenAITools } from './openai.tools';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentResponse,
  BytebotAgentModel,
} from '../agent/agent.types';
import { supportsVision } from '../agent/vision-capability.util';
import { transformImagesForNonVision } from '../agent/message-transformer.util';

@Injectable()
export class OpenAIService implements BytebotAgentService {
  private openai: OpenAI | null = null;
  private currentApiKey: string | null = null;
  private hasLoggedMissingKey = false;
  private readonly logger = new Logger(OpenAIService.name);

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  async generateMessage(
    systemPrompt: string,
    messages: Message[],
    modelName: string = DEFAULT_MODEL.name,
    modelMetadata: BytebotAgentModel,
    useTools: boolean = true,
    signal?: AbortSignal,
    directVisionMode: boolean = false,
  ): Promise<BytebotAgentResponse> {
    const isReasoning = modelName.startsWith('o');
    try {
      const openaiClient = this.getOpenAIClient();

      // Transform images to text for non-vision models
      const processedMessages = supportsVision(modelMetadata)
        ? messages  // Keep images for vision models
        : transformImagesForNonVision(messages);  // Replace images with text for non-vision models

      const openaiMessages = this.formatMessagesForOpenAI(processedMessages);

      const maxTokens = 8192;
      const response = await openaiClient.responses.create(
        {
          model: modelName,
          max_output_tokens: maxTokens,
          input: openaiMessages,
          instructions: systemPrompt,
          tools: useTools ? getOpenAITools(directVisionMode) : [],
          reasoning: isReasoning ? { effort: 'medium' } : null,
          store: false,
          include: isReasoning ? ['reasoning.encrypted_content'] : [],
        },
        { signal },
      );

      return {
        contentBlocks: this.formatOpenAIResponse(response.output),
        tokenUsage: {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      console.log('error', error);
      console.log('error name', error.name);

      if (error instanceof APIUserAbortError) {
        this.logger.log('OpenAI API call aborted');
        throw new BytebotAgentInterrupt();
      }
      this.logger.error(
        `Error sending message to OpenAI: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Fetch available models from OpenAI API
   * Returns dynamic list of models or falls back to hardcoded list on error
   */
  async listModels(): Promise<BytebotAgentModel[]> {
    try {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        this.logger.warn('OpenAI API key not set, returning empty model list');
        return [];
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Filter for chat/completion models only
      const chatModels = data.data.filter((model: any) =>
        model.id.startsWith('gpt-') ||
        model.id.startsWith('o1') ||
        model.id.startsWith('o3') ||
        model.id.includes('turbo')
      );

      return chatModels.map((model: any) => ({
        provider: 'openai' as const,
        name: model.id,
        title: this.formatModelTitle(model.id),
        contextWindow: this.inferContextWindow(model.id),
        supportsVision: this.inferVisionSupport(model.id),
      }));
    } catch (error: any) {
      this.logger.error(`Failed to fetch OpenAI models: ${error.message}`);
      this.logger.log('Falling back to hardcoded OpenAI model list');
      return DEFAULT_MODEL ? [DEFAULT_MODEL] : [];
    }
  }

  /**
   * Format model ID into a human-readable title
   */
  private formatModelTitle(modelId: string): string {
    // Handle specific models
    if (modelId === 'gpt-4o') return 'GPT-4o';
    if (modelId === 'gpt-4o-mini') return 'GPT-4o Mini';
    if (modelId === 'o1') return 'o1';
    if (modelId === 'o1-preview') return 'o1 Preview';
    if (modelId === 'o1-mini') return 'o1 Mini';
    if (modelId === 'gpt-4-turbo') return 'GPT-4 Turbo';
    if (modelId === 'gpt-4-turbo-preview') return 'GPT-4 Turbo Preview';
    if (modelId === 'gpt-3.5-turbo') return 'GPT-3.5 Turbo';

    // Default: capitalize and clean up
    return modelId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Infer context window size based on model name
   */
  private inferContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 128000;
    if (modelId.includes('o1')) return 200000;
    if (modelId.includes('gpt-4-turbo')) return 128000;
    if (modelId.includes('gpt-4')) return 8192;
    if (modelId.includes('gpt-3.5-turbo')) return 16385;
    if (modelId.includes('gpt-3.5')) return 4096;
    return 8192; // Default
  }

  /**
   * Infer vision support based on model name
   */
  private inferVisionSupport(modelId: string): boolean {
    // GPT-4o and GPT-4 Turbo variants support vision
    if (modelId.includes('gpt-4o')) return true;
    if (modelId.includes('gpt-4-turbo')) return true;
    if (modelId.includes('gpt-4-vision')) return true;

    // o1 series and GPT-3.5 do not support vision
    return false;
  }

  private initializeClient() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logMissingKey();
      this.openai = new OpenAI({
        apiKey: 'dummy-key-for-initialization',
      });
      this.currentApiKey = null;
      return;
    }

    this.openai = new OpenAI({ apiKey });
    this.currentApiKey = apiKey;
    this.hasLoggedMissingKey = false;
  }

  private getOpenAIClient(): OpenAI {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (apiKey && apiKey !== this.currentApiKey) {
      this.openai = new OpenAI({ apiKey });
      this.currentApiKey = apiKey;
      this.hasLoggedMissingKey = false;
    }

    if (!apiKey) {
      this.logMissingKey();

      if (!this.openai) {
        this.openai = new OpenAI({
          apiKey: 'dummy-key-for-initialization',
        });
      }

      this.currentApiKey = null;
    }

    return this.openai!;
  }

  private logMissingKey() {
    if (!this.hasLoggedMissingKey) {
      this.logger.warn(
        'OPENAI_API_KEY is not set. OpenAIService will not work properly.',
      );
      this.hasLoggedMissingKey = true;
    }
  }

  private formatMessagesForOpenAI(
    messages: Message[],
  ): OpenAI.Responses.ResponseInputItem[] {
    const openaiMessages: OpenAI.Responses.ResponseInputItem[] = [];

    for (const message of messages) {
      const messageContentBlocks = message.content as MessageContentBlock[];

      if (
        messageContentBlocks.every((block) => isUserActionContentBlock(block))
      ) {
        const userActionContentBlocks = messageContentBlocks.flatMap(
          (block) => block.content,
        );
        for (const block of userActionContentBlocks) {
          if (isComputerToolUseContentBlock(block)) {
            openaiMessages.push({
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `User performed action: ${block.name}\n${JSON.stringify(block.input, null, 2)}`,
                },
              ],
            });
          } else if (isImageContentBlock(block)) {
            openaiMessages.push({
              role: 'user',
              type: 'message',
              content: [
                {
                  type: 'input_image',
                  detail: 'high',
                  image_url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              ],
            } as OpenAI.Responses.ResponseInputItem.Message);
          }
        }
      } else {
        // Convert content blocks to OpenAI format
        for (const block of messageContentBlocks) {
          switch (block.type) {
            case MessageContentType.Text: {
              if (message.role === Role.USER) {
                openaiMessages.push({
                  type: 'message',
                  role: 'user',
                  content: [
                    {
                      type: 'input_text',
                      text: block.text,
                    },
                  ],
                } as OpenAI.Responses.ResponseInputItem.Message);
              } else {
                openaiMessages.push({
                  type: 'message',
                  role: 'assistant',
                  content: [
                    {
                      type: 'output_text',
                      text: block.text,
                    },
                  ],
                } as OpenAI.Responses.ResponseOutputMessage);
              }
              break;
            }
            case MessageContentType.ToolUse:
              // For assistant messages with tool use, convert to function call
              if (message.role === Role.ASSISTANT) {
                const toolBlock = block as ToolUseContentBlock;
                openaiMessages.push({
                  type: 'function_call',
                  call_id: toolBlock.id,
                  name: toolBlock.name,
                  arguments: JSON.stringify(toolBlock.input),
                } as OpenAI.Responses.ResponseFunctionToolCall);
              }
              break;

            case MessageContentType.Thinking: {
              const thinkingBlock = block;
              openaiMessages.push({
                type: 'reasoning',
                id: thinkingBlock.signature,
                encrypted_content: thinkingBlock.thinking,
                summary: [],
              } as OpenAI.Responses.ResponseReasoningItem);
              break;
            }
            case MessageContentType.ToolResult: {
              // Handle tool results as function call outputs only.
              // Avoid inserting extra user image messages here to satisfy tool_call sequencing.
              const toolResult = block;
              for (const content of toolResult.content) {
                if (content.type === MessageContentType.Text) {
                  openaiMessages.push({
                    type: 'function_call_output',
                    call_id: toolResult.tool_use_id,
                    output: content.text,
                  } as OpenAI.Responses.ResponseInputItem.FunctionCallOutput);
                }
                if (content.type === MessageContentType.Image) {
                  openaiMessages.push({
                    type: 'function_call_output',
                    call_id: toolResult.tool_use_id,
                    output: 'screenshot',
                  } as OpenAI.Responses.ResponseInputItem.FunctionCallOutput);
                }
              }
              break;
            }

            default:
              // Handle unknown content types as text
              openaiMessages.push({
                role: 'user',
                type: 'message',
                content: [
                  {
                    type: 'input_text',
                    text: JSON.stringify(block),
                  },
                ],
              } as OpenAI.Responses.ResponseInputItem.Message);
          }
        }
      }
    }

    return openaiMessages;
  }

  private formatOpenAIResponse(
    response: OpenAI.Responses.ResponseOutputItem[],
  ): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];

    for (const item of response) {
      // Check the type of the output item
      switch (item.type) {
        case 'message':
          // Handle ResponseOutputMessage
          const message = item;
          for (const content of message.content) {
            if ('text' in content) {
              // ResponseOutputText
              contentBlocks.push({
                type: MessageContentType.Text,
                text: content.text,
              } as TextContentBlock);
            } else if ('refusal' in content) {
              // ResponseOutputRefusal
              contentBlocks.push({
                type: MessageContentType.Text,
                text: `Refusal: ${content.refusal}`,
              } as TextContentBlock);
            }
          }
          break;

        case 'function_call':
          // Handle ResponseFunctionToolCall
          const toolCall = item;
          contentBlocks.push({
            type: MessageContentType.ToolUse,
            id: toolCall.call_id,
            name: toolCall.name,
            input: JSON.parse(toolCall.arguments),
          } as ToolUseContentBlock);
          break;

        case 'file_search_call':
        case 'web_search_call':
        case 'computer_call':
        case 'reasoning':
          const reasoning = item as OpenAI.Responses.ResponseReasoningItem;
          if (reasoning.encrypted_content) {
            contentBlocks.push({
              type: MessageContentType.Thinking,
              thinking: reasoning.encrypted_content,
              signature: reasoning.id,
            } as ThinkingContentBlock);
          }
          break;
        case 'image_generation_call':
        case 'code_interpreter_call':
        case 'local_shell_call':
        case 'mcp_call':
        case 'mcp_list_tools':
        case 'mcp_approval_request':
          // Handle other tool types as text for now
          this.logger.warn(
            `Unsupported response output item type: ${item.type}`,
          );
          contentBlocks.push({
            type: MessageContentType.Text,
            text: JSON.stringify(item),
          } as TextContentBlock);
          break;

        default:
          // Handle unknown types
          this.logger.warn(
            `Unknown response output item type: ${JSON.stringify(item)}`,
          );
          contentBlocks.push({
            type: MessageContentType.Text,
            text: JSON.stringify(item),
          } as TextContentBlock);
      }
    }

    return contentBlocks;
  }
}
