'use client';

import { useState, useCallback } from 'react';
import { ChatMessage } from '@/types';

interface UseChatOptions {
  onAssistantMessage?: (message: string) => void;
  onToken?: (token: string) => void;
}

export function useChat({ onAssistantMessage, onToken }: UseChatOptions = {}) {
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
    [messages, onAssistantMessage, onToken]
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
