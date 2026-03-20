'use client';

export function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <span className="dot"></span>
      <span className="dot"></span>
      <span className="dot"></span>
      <style jsx>{`
        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 16px 20px;
          background: #141414;
          border: 1px solid #1f1f1f;
          border-radius: 20px 20px 20px 4px;
          width: fit-content;
          margin-bottom: 12px;
          animation: slideIn 0.3s ease;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #6366f1;
          animation: bounce 1.4s infinite ease-in-out both;
        }

        .dot:nth-child(1) {
          animation-delay: -0.32s;
        }

        .dot:nth-child(2) {
          animation-delay: -0.16s;
        }

        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
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