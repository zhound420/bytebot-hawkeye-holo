import { Message } from '@prisma/client';
import { MessageContentBlock } from '@bytebot/shared';

export interface BytebotAgentResponse {
  contentBlocks: MessageContentBlock[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface BytebotAgentService {
  generateMessage(
    systemPrompt: string,
    messages: Message[],
    modelName: string,
    modelMetadata: BytebotAgentModel,
    useTools: boolean,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse>;
}

export interface BytebotAgentModel {
  provider: 'anthropic' | 'openai' | 'google' | 'proxy';
  name: string;
  title: string;
  contextWindow?: number;
  supportsVision?: boolean;
  // LiteLLM metadata for advanced routing and tier detection
  inputCost?: number; // Cost per input token (e.g., 0.000002 for tier1)
  outputCost?: number; // Cost per output token
  maxTokens?: number; // Maximum output tokens
  latency?: number; // Average latency in ms
  supportsPromptCaching?: boolean; // Anthropic cache_control support
  supportsReasoningEffort?: boolean; // OpenAI o3/o1 reasoning_effort support
}

export class BytebotAgentInterrupt extends Error {
  constructor() {
    super('BytebotAgentInterrupt');
    this.name = 'BytebotAgentInterrupt';
  }
}
