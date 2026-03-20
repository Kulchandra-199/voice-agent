'use client';

import { useState, useEffect } from 'react';

interface VoiceOrbProps {
  isListening: boolean;
  isSpeaking: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  disabled?: boolean;
}

export function VoiceOrb({
  isListening,
  isSpeaking,
  onStartListening,
  onStopListening,
  disabled = false,
}: VoiceOrbProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    if (isListening) {
      onStopListening();
    } else {
      onStartListening();
    }
  };

  return (
    <div
      className="voice-orb-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pulse rings when listening */}
      {isListening && (
        <>
          <div className="pulse-ring ring-1" />
          <div className="pulse-ring ring-2" />
          <div className="pulse-ring ring-3" />
        </>
      )}

      {/* Glow effect when speaking */}
      {(isSpeaking || isHovered) && <div className="glow-layer" />}

      <button
        className={`voice-orb ${isListening ? 'listening' : ''} ${isSpeaking ? 'speaking' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label={isListening ? 'Stop recording' : 'Start recording'}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mic-icon"
        >
          {isListening ? (
            // Stop icon
            <rect x="6" y="6" width="12" height="12" rx="2" />
          ) : (
            // Mic icon
            <>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </>
          )}
        </svg>
      </button>

      <style jsx>{`
        .voice-orb-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-orb {
          position: relative;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: linear-gradient(145deg, #1a1a2e, #141414);
          border: 2px solid #1f1f1f;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          z-index: 10;
        }

        .voice-orb:hover:not(.disabled) {
          border-color: #6366f1;
          transform: scale(1.05);
        }

        .voice-orb.listening {
          background: linear-gradient(145deg, #2a1a4e, #1a1a2e);
          border-color: #6366f1;
          box-shadow: 0 0 30px rgba(99, 102, 241, 0.4);
        }

        .voice-orb.speaking {
          background: linear-gradient(145deg, #1a2e2e, #141414);
          border-color: #4ade80;
          box-shadow: 0 0 30px rgba(74, 222, 128, 0.3);
        }

        .voice-orb.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mic-icon {
          width: 32px;
          height: 32px;
          color: #f5f5f5;
        }

        .voice-orb.listening .mic-icon {
          color: #6366f1;
        }

        .voice-orb.speaking .mic-icon {
          color: #4ade80;
        }

        .pulse-ring {
          position: absolute;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: 2px solid #6366f1;
          animation: pulse 2s ease-out infinite;
        }

        .ring-1 { animation-delay: 0s; }
        .ring-2 { animation-delay: 0.5s; }
        .ring-3 { animation-delay: 1s; }

        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }

        .glow-layer {
          position: absolute;
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}