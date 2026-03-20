'use client';

import { ChatMessage } from '@/types';

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`message-container ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-bubble">
        {message.content}
      </div>
      <style jsx>{`
        .message-container {
          display: flex;
          margin-bottom: 12px;
          animation: slideIn 0.3s ease;
        }

        .message-container.user {
          justify-content: flex-end;
        }

        .message-container.assistant {
          justify-content: flex-start;
        }

        .message-bubble {
          max-width: 75%;
          padding: 14px 18px;
          font-size: 15px;
          line-height: 1.5;
          word-wrap: break-word;
        }

        .user .message-bubble {
          background: var(--user-bubble);
          color: var(--text-primary);
          border-radius: 20px 20px 4px 20px;
          border: 1px solid var(--primary);
        }

        .assistant .message-bubble {
          background: var(--bot-bubble);
          color: var(--text-primary);
          border-radius: 20px 20px 20px 4px;
          border: 1px solid var(--border);
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}