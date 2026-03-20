'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/types';

interface UseChatOptions {
  onAssistantMessage?: (message: string) => void;
  onToken?: (token: string) => void;
}

export function useChat({ onAssistantMessage }: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (content: string, accessToken?: string) => {
      const userMessage: ChatMessage = { role: 'user', content };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const messageHistory = [...messages, userMessage].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            messages: messageHistory,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        const fullReply = data.reply || '';

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullReply,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (onAssistantMessage) {
          onAssistantMessage(fullReply);
        }

        return fullReply;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [messages, onAssistantMessage]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
}

// ============== STREAMING CHAT ==============

export interface StreamingChatOptions {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError?: (error: string) => void;
}

export function useStreamingChat({ onToken, onComplete, onError }: StreamingChatOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    async (content: string, accessToken?: string) => {
      console.log('[StreamingChat] startStream called with:', content.substring(0, 100));
      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      let fullText = '';

      try {
        const messageHistory = [{ role: 'user' as const, content }];
        const backendUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/chat/stream`;
        console.log('[StreamingChat] Fetching:', backendUrl);

        const response = await fetch(
          backendUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({ messages: messageHistory }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let tokenCount = 0;
        let rawChunkCount = 0;

        console.log('[StreamingChat] Response ok, starting to read stream');

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[StreamingChat] Reader done, buffer:', JSON.stringify(buffer).substring(0, 100));
            break;
          }

          rawChunkCount++;
          const raw = decoder.decode(value, { stream: true });
          buffer += raw;

          if (rawChunkCount <= 3) console.log('[StreamingChat] Raw chunk', rawChunkCount, ':', raw.substring(0, 150));

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) {
              if (line.trim()) console.log('[StreamingChat] Non-data line:', line.substring(0, 80));
              continue;
            }
            const data = line.slice(6).trim();
            console.log('[StreamingChat] SSE data:', JSON.stringify(data).substring(0, 80));
            if (data === '[DONE]' || data === '[DONE]\n') {
              console.log('[StreamingChat] Received [DONE], fullText length:', fullText.length);
              onComplete(fullText);
              setIsStreaming(false);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (tokenCount < 3) console.log('[StreamingChat] Parsed token keys:', Object.keys(parsed).join(','), 'value:', JSON.stringify(parsed).substring(0, 80));
              if (parsed.token) {
                tokenCount++;
                fullText += parsed.token;
                onToken(parsed.token);
              }
              if (parsed.error) {
                console.error('[StreamingChat] Error in stream:', parsed.error);
                onError?.(parsed.error);
                setIsStreaming(false);
                return;
              }
            } catch (e: unknown) {
              console.log('[StreamingChat] JSON parse error:', e instanceof Error ? e.message : String(e), 'line:', line.substring(0, 80));
              // Skip malformed JSON
            }
          }
        }

        console.log('[StreamingChat] Stream ended naturally, rawChunks:', rawChunkCount, 'tokenCount:', tokenCount, 'fullText length:', fullText.length);

        onComplete(fullText);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[StreamingChat] Stream aborted');
        } else {
          const errorMessage = err instanceof Error ? err.message : 'Stream failed';
          onError?.(errorMessage);
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [onToken, onComplete, onError]
  );

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    startStream,
    abort,
  };
}
