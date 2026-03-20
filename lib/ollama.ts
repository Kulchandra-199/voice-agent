import { ChatMessage, ToolSchemas } from '@/types';

export async function callOllamaWithTools(messages: ChatMessage[]): Promise<any> {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:72b';
  const apiKey = process.env.OLLAMA_CLOUD_API_KEY;

  if (!baseUrl) {
    throw new Error('OLLAMA_BASE_URL is not configured');
  }

  // Import tool schemas
  const { TOOL_SCHEMAS } = await import('@/lib/tools');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add API key for Ollama Cloud
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      tools: TOOL_SCHEMAS,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error: ${response.status} ${errorText}`);
  }

  return response.json();
}