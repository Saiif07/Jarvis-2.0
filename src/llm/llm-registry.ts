import type { LLMProvider } from './types';
import { ClaudeProvider } from './claude-provider';
import { OpenAIProvider } from './openai-provider';

export type ProviderType = 'claude' | 'openai' | 'custom';

export interface CreateProviderOptions {
  provider: ProviderType;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
}

// Built-in Default Free Setup (Zero Setup Fallback)
const DEFAULT_GROQ_KEY = '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';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Create an LLM provider based on the specified configuration.
 *
 * @param options - Provider configuration
 * @returns An instance of the appropriate LLM provider
 */
export function createLLMProvider(options: CreateProviderOptions): LLMProvider {
  let { provider, apiKey, model, customBaseUrl } = options;

  // Key missing or empty -> Auto Switch to Free Groq AI
  if (!apiKey || apiKey.trim() === '') {
    apiKey = DEFAULT_GROQ_KEY;
    provider = 'custom';
    customBaseUrl = DEFAULT_BASE_URL;
    model = DEFAULT_MODEL;
  }

  switch (provider) {
    case 'claude':
      return new ClaudeProvider(apiKey, model);

    case 'custom':
      const finalBaseUrl = customBaseUrl || DEFAULT_BASE_URL;
      return new OpenAIProvider(apiKey, model || DEFAULT_MODEL, finalBaseUrl);

    case 'openai':
    default:
      return new OpenAIProvider(apiKey, model || DEFAULT_MODEL);
  }
}
