'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/types';

interface UseChatOptions {
  /** Full reply after non-streaming response or stream complete (for fallback / compatibility). */
  onAssistantMessage?: (message: string) => void;
  /** Token-level stream for speech pipeline (TTS buffers into sentence chunks client-side). */
  onAssistantTokenStream?: (tokens: AsyncIterable<string>) => void | Promise<void>;
}

async function* parseChatSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<
  | { type: 'token'; text: string }
  | { type: 'done'; reply: string; conversationId: string }
  | { type: 'error'; reply?: string }
> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const blocks = carry.split('\n\n');
    carry = blocks.pop() ?? '';

    for (const block of blocks) {
      for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.replace(/^data:\s*/, '').trim();
        if (!payload || payload === '[DONE]') continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const t = data.type;
        if (t === 'token' && typeof data.text === 'string') {
          yield { type: 'token', text: data.text };
        } else if (t === 'done' && typeof data.reply === 'string') {
          yield {
            type: 'done',
            reply: data.reply,
            conversationId: typeof data.conversationId === 'string' ? data.conversationId : '',
          };
        } else if (t === 'error') {
          yield {
            type: 'error',
            reply: typeof data.reply === 'string' ? data.reply : undefined,
          };
        }
      }
    }
  }
}

export function useChat({ onAssistantMessage, onAssistantTokenStream }: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const startNewConversationNextRef = useRef(false);
  const onAssistantMessageRef = useRef(onAssistantMessage);
  const onAssistantTokenStreamRef = useRef(onAssistantTokenStream);
  onAssistantMessageRef.current = onAssistantMessage;
  onAssistantTokenStreamRef.current = onAssistantTokenStream;

  const sendMessage = useCallback(async (content: string, accessToken?: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    const userMessage: ChatMessage = { role: 'user', content };
    messagesRef.current = [...messagesRef.current, userMessage];
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const messageHistory = messagesRef.current.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const startNew = startNewConversationNextRef.current;
      const clientTimeZone =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          messages: messageHistory,
          stream: true,
          ...(clientTimeZone ? { timeZone: clientTimeZone } : {}),
          ...(conversationIdRef.current && !startNew ? { conversationId: conversationIdRef.current } : {}),
          ...(startNew ? { startNewConversation: true } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' };
        messagesRef.current = [...messagesRef.current, assistantPlaceholder];
        setMessages((prev) => [...prev, assistantPlaceholder]);

        let fullReply = '';
        let uiPending = '';
        let rafId: number | null = null;

        const flushUi = () => {
          rafId = null;
          if (!uiPending) return;
          const snapshot = fullReply;
          uiPending = '';
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: snapshot };
            }
            return next;
          });
          messagesRef.current = [...messagesRef.current.slice(0, -1), { role: 'assistant', content: snapshot }];
        };

        const scheduleUi = () => {
          if (rafId != null) return;
          rafId = requestAnimationFrame(flushUi);
        };

        const tokenIterable = async function* (): AsyncGenerator<string, void, undefined> {
          for await (const ev of parseChatSse(response.body)) {
            if (ev.type === 'token') {
              fullReply += ev.text;
              uiPending += ev.text;
              scheduleUi();
              yield ev.text;
            } else if (ev.type === 'done') {
              if (typeof ev.conversationId === 'string' && ev.conversationId) {
                conversationIdRef.current = ev.conversationId;
              }
              fullReply = ev.reply;
              if (rafId != null) {
                cancelAnimationFrame(rafId);
                rafId = null;
              }
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: fullReply };
                }
                return next;
              });
              messagesRef.current = [...messagesRef.current.slice(0, -1), { role: 'assistant', content: fullReply }];
              return;
            } else if (ev.type === 'error') {
              throw new Error(ev.reply || 'Stream error');
            }
          }
        };

        const gen = tokenIterable();
        const streamHandler = onAssistantTokenStreamRef.current;
        if (streamHandler) {
          await streamHandler(gen);
        } else {
          for await (const _ of gen) {
            void _;
          }
        }

        if (startNew) {
          startNewConversationNextRef.current = false;
        }

        return fullReply;
      }

      const data = await response.json();
      const fullReply = data.reply || '';

      if (typeof data.conversationId === 'string') {
        conversationIdRef.current = data.conversationId;
      }
      if (startNew) {
        startNewConversationNextRef.current = false;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: fullReply,
      };

      messagesRef.current = [...messagesRef.current, assistantMessage];
      setMessages((prev) => [...prev, assistantMessage]);

      if (onAssistantMessageRef.current) {
        onAssistantMessageRef.current(fullReply);
      }

      return fullReply;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    messagesRef.current = [];
    conversationIdRef.current = null;
    startNewConversationNextRef.current = true;
  }, []);

  return {
    messages,
    setMessages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    abort,
  };
}
