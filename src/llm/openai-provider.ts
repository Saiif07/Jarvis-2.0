export interface OpenAIConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

// Built-in Default Free AI Config (App install hote hi bina key ke chalega)
const FALLBACK_BASE_URL = 'https://api.groq.com/openai/v1';
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_API_KEY = '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'; // System Auto-Fallback

export function formatBaseUrl(rawUrl?: string): string {
  if (!rawUrl || rawUrl.trim() === '') {
    return FALLBACK_BASE_URL;
  }
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.replace('/chat/completions', '');
  }
  return url;
}

export function getEffectiveConfig(config?: OpenAIConfig) {
  const apiKey = (config?.apiKey && config.apiKey.trim() !== '') 
    ? config.apiKey.trim() 
    : FALLBACK_API_KEY;

  const baseUrl = formatBaseUrl(config?.baseUrl);

  const model = (config?.model && config.model.trim() !== '' && config.model !== 'gpt-4o') 
    ? config.model 
    : FALLBACK_MODEL;

  return { apiKey, baseUrl, model };
}

export async function testOpenAIConnection(config: OpenAIConfig): Promise<boolean> {
  const active = getEffectiveConfig(config);

  const response = await fetch(`${active.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${active.apiKey}`,
    },
    body: JSON.stringify({
      model: active.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return true;
}
