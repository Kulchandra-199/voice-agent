'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/types';

interface UseChatOptions {
  onAssistantMessage?: (message: string) => void;
}

export function useChat({ onAssistantMessage }: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const startNewConversationNextRef = useRef(false);
  const onAssistantMessageRef = useRef(onAssistantMessage);
  onAssistantMessageRef.current = onAssistantMessage;

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
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          messages: messageHistory,
          ...(conversationIdRef.current && !startNew ? { conversationId: conversationIdRef.current } : {}),
          ...(startNew ? { startNewConversation: true } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
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
