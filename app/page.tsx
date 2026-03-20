'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChatMessage } from '@/types';
import { VoiceOrb } from '@/components/VoiceOrb';
import { ChatBubble } from '@/components/ChatBubble';
import { TypingIndicator } from '@/components/TypingIndicator';
import { useVoice } from '@/hooks/useVoice';
import { useChat } from '@/hooks/useChat';
import { useVAD } from '@/hooks/useVAD';
import { TTSProviderInner, useTTS } from '@/components/TTSProviderInner';

function getStoredUser() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getAuthToken(): string | null {
  return getStoredUser()?.token ?? null;
}

function ChatInterface() {
  const [showChat, setShowChat] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Refs for chat pipeline
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessagesRef = useRef<((updater: React.SetStateAction<ChatMessage[]>) => void) | null>(null);
  const isVADRunningRef = useRef(false);
  const speakRef = useRef<((text: string) => Promise<void>) | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const user = getStoredUser();
      if (user) {
        try {
          setIsLoggedIn(true);
          setUserEmail(user.email || user.username);

          const token = user.token ?? null;
          const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/status`, { headers });
            const data = await res.json();
            if (data.connected || data.hasGoogleCalendar) {
              setCalendarConnected(true);
            }
          } catch (err) {
            console.error('Failed to check calendar status:', err);
          }
        } catch (e) {
          localStorage.removeItem('user');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!loading && !isLoggedIn) {
      router.push('/login');
    }
  }, [loading, isLoggedIn, router]);

  const handleLogout = () => {
    localStorage.removeItem('user');
    setIsLoggedIn(false);
    router.push('/login');
  };

  const handleNewChat = () => {
    clearMessages();
    setShowChat(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    const tokens = params.get('tokens');

    if (auth === 'success' && tokens) {
      try {
        const decoded = JSON.parse(atob(tokens));
        setCalendarConnected(true);
        window.history.replaceState({}, '', '/');
      } catch (e) {
        console.error('Failed to parse tokens:', e);
      }
    }

    if (auth === 'success' && !tokens) {
      setCalendarConnected(true);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const { isSpeaking, speak, stopSpeaking, voices, selectedVoice, setVoice } = useTTS();

  // Stable ref for stopSpeaking used in VAD callback
  const stopSpeakingRef = useRef<(() => void) | null>(null);
  stopSpeakingRef.current = stopSpeaking;
  speakRef.current = speak;

  // useChat — must be before handleTranscript and useVAD callbacks that use abort/sendMessage
  const { messages, setMessages, isLoading, sendMessage, clearMessages, abort } = useChat({
    onAssistantMessage: (reply) => {
      if (reply?.trim()) {
        speakRef.current?.(reply);
      }
    }
  });
  setMessagesRef.current = setMessages;

  // VAD — uses abort() from useChat above
  const { isSpeechDetected, start: startVAD, stop: stopVAD } = useVAD({
    onSpeechStart: () => {
      if (!isSpeaking) return;
      console.log('[VAD] Speech detected — interrupting TTS');
      stopSpeakingRef.current?.();
      abort();
      stopVAD();
    },
  });

  // useVoice — uses handleTranscript below, but start/stop are passed as callbacks
  const { isListening, isProcessing, status, error, startListening, stopListening, clearError } = useVoice({
    onTranscript: handleTranscript,
  });

  // What to do when user clicks orb while TTS is playing — stop TTS and start listening
  const handleOrbClickWhileSpeaking = useCallback(() => {
    console.log('[Orb] Clicked while speaking — interrupting and starting listening');
    stopSpeakingRef.current?.();
    abort();
    startListening();
  }, [abort]);

  // Orb click handler — decides based on current state
  const handleVoiceOrbClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else if (isSpeaking) {
      handleOrbClickWhileSpeaking();
    } else {
      startListening();
    }
  }, [isListening, isSpeaking, stopListening, startListening, handleOrbClickWhileSpeaking]);

  async function handleTranscript(text: string) {
    console.log('[Page] handleTranscript:', text);
    if (!showChat) setShowChat(true);
    stopSpeakingRef.current?.();
    abort();

    try {
      await sendMessage(text, getAuthToken() || undefined);
    } catch (err) {
      console.error('[Page] handleTranscript error:', err);
    }
  }

  // Keep refs up to date
  stopSpeakingRef.current = stopSpeaking;

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      handleTranscript(inputText);
      setInputText('');
    }
  };

  const handleConnectCalendar = async () => {
    setConnectingCalendar(true);
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/google`, { headers });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
    } catch (err) {
      console.error('Failed to get auth URL:', err);
    }
    setConnectingCalendar(false);
  };

  const handleDisconnectCalendar = async () => {
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/disconnect`, { method: 'POST', headers });
    } catch (err) {
      console.error('Failed to disconnect calendar:', err);
    }
    setCalendarConnected(false);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <style jsx>{`
          .loading-screen {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--background);
          }
          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="calendar-icon"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="app-name">Aria</span>
        </div>

        <div className="header-center">
          <div className="voice-selector">
            <button
              className="voice-selector-btn"
              onClick={() => setShowVoiceMenu(!showVoiceMenu)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
              <span>{selectedVoice || 'Select Voice'}</span>
              <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {showVoiceMenu && (
              <div className="voice-dropdown">
                {voices.map((v) => (
                  <button
                    key={v.name}
                    className={`voice-option ${selectedVoice === v.name ? 'active' : ''}`}
                    onClick={() => {
                      setVoice(v.name);
                      setShowVoiceMenu(false);
                    }}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="header-right">
          {isLoggedIn && (
            <div className="user-info">
              {calendarConnected ? (
                <button
                  onClick={async () => {
                    const token = getAuthToken();
                    if (token) {
                      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/disconnect`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      setCalendarConnected(false);
                    }
                  }}
                  className="calendar-btn disconnect"
                >
                  Disconnect Calendar
                </button>
              ) : (
                <button
                  onClick={handleConnectCalendar}
                  className="calendar-btn connect"
                  disabled={connectingCalendar}
                >
                  {connectingCalendar ? 'Connecting...' : 'Connect Calendar'}
                </button>
              )}
              <button onClick={handleNewChat} className="new-chat-btn">
                New Chat
              </button>
              <button onClick={handleLogout} className="logout-btn">
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {!showChat ? (
          <div className="welcome-screen">
            <div className="welcome-text">
              <h1>Voice-Powered</h1>
              <h1>Scheduling Assistant</h1>
              <p>Press the orb or type to tell Aria when you need to meet</p>
            </div>
          </div>
        ) : (
          <div className="chat-container" ref={chatContainerRef}>
            {messages.map((msg, index) => (
              <ChatBubble key={index} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
          </div>
        )}

        {error && (
          <div className="error-toast">
            <span>{error}</span>
            <button onClick={clearError} className="dismiss-btn">×</button>
          </div>
        )}
      </main>

      <div className="bottom-section">
        <div className="unified-input-bar">
          {/* Mode toggle pill */}
          <button
            className="mode-toggle"
            onClick={() => setInputMode(inputMode === 'voice' ? 'text' : 'voice')}
            title={inputMode === 'voice' ? 'Switch to text' : 'Switch to voice'}
          >
            {inputMode === 'voice' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
            )}
            <span>{inputMode === 'voice' ? 'Voice' : 'Text'}</span>
          </button>

          {/* Input area */}
          <div className="input-area">
            {inputMode === 'text' ? (
              <form className="text-input-form" onSubmit={handleSubmitText}>
                <input
                  type="text"
                  className="text-input"
                  placeholder="Ask Aria anything..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isLoading}
                  autoFocus
                />
                {inputText.trim() && (
                  <button type="submit" className="send-btn" disabled={isLoading}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                )}
              </form>
            ) : (
              <div className="voice-orb-wrapper">
                <VoiceOrb
                  isListening={isListening}
                  isSpeaking={isSpeaking}
                  onStartListening={startListening}
                  onStopListening={handleVoiceOrbClick}
                />
              </div>
            )}
          </div>

          {/* Status text */}
          <div className="status-area">
            <span className="status-text">
              {isProcessing
                ? 'Processing...'
                : isListening
                ? status
                : isSpeaking
                ? 'Speaking...'
                : inputMode === 'voice'
                ? 'Tap the orb to speak'
                : 'Press enter to send'}
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .app-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 24px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .calendar-icon {
          width: 24px;
          height: 24px;
          color: var(--primary);
        }

        .app-name {
          font-family: var(--font-inter);
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(135deg, var(--text-primary), var(--primary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header-center {
          position: relative;
        }

        .voice-selector {
          position: relative;
        }

        .voice-selector-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 20px;
          color: var(--text-primary);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .voice-selector-btn:hover {
          border-color: var(--primary);
        }

        .voice-selector-btn svg {
          width: 16px;
          height: 16px;
          color: var(--primary);
        }

        .voice-selector-btn .chevron {
          width: 14px;
          height: 14px;
          color: var(--text-secondary);
        }

        .voice-dropdown {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 8px;
          min-width: 180px;
          max-height: 200px;
          overflow-y: auto;
          z-index: 200;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .voice-option {
          display: block;
          width: 100%;
          padding: 10px 14px;
          background: none;
          border: none;
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          transition: background 0.2s;
        }

        .voice-option:hover {
          background: rgba(99, 102, 241, 0.1);
        }

        .voice-option.active {
          background: rgba(99, 102, 241, 0.2);
          color: var(--primary);
        }

        .header-right {
          display: flex;
          align-items: center;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .calendar-status {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .calendar-status.connected {
          color: var(--success);
        }

        .calendar-btn {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .calendar-btn.connect {
          background: var(--primary);
          color: white;
          border: none;
        }

        .calendar-btn.connect:hover:not(:disabled) {
          background: var(--primary-hover);
        }

        .calendar-btn.connect:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .new-chat-btn {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          background: none;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          transition: all 0.2s;
        }

        .new-chat-btn:hover {
          border-color: var(--primary);
          color: var(--primary);
          background: rgba(99, 102, 241, 0.1);
        }

        .logout-btn {
          background: none;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .logout-btn:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: #ef4444;
          color: #ef4444;
        }

        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          max-width: 640px;
          width: 100%;
          margin: 0 auto;
          padding: 20px;
          padding-bottom: 180px;
          overflow-y: auto;
        }

        .welcome-screen {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .welcome-text h1 {
          font-family: var(--font-inter);
          font-size: 40px;
          font-weight: 700;
          line-height: 1.1;
          margin-bottom: 16px;
        }

        .welcome-text p {
          color: var(--text-secondary);
          font-size: 16px;
        }

        .chat-container {
          flex: 1;
          overflow-y: auto;
        }

        .error-toast {
          position: fixed;
          bottom: 200px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(239, 68, 68, 0.9);
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 14px;
          animation: slideUp 0.3s ease;
          z-index: 101;
        }

        .dismiss-btn {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }

        .bottom-section {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          padding: 0 20px 32px;
          z-index: 100;
        }

        .unified-input-bar {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          width: 100%;
          max-width: 560px;
        }

        .mode-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .mode-toggle:hover {
          border-color: var(--primary);
          color: var(--primary);
        }

        .mode-toggle svg {
          width: 14px;
          height: 14px;
        }

        .input-area {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .text-input-form {
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 28px;
          padding: 12px 20px;
          width: 100%;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .text-input-form:focus-within {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px var(--primary-glow);
        }

        .text-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 15px;
          outline: none;
          padding: 4px 0;
        }

        .text-input::placeholder {
          color: var(--text-secondary);
        }

        .send-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--primary);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          animation: popIn 0.2s ease;
        }

        @keyframes popIn {
          from { transform: scale(0.8); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .send-btn:not(:disabled):hover {
          background: var(--primary-hover);
          transform: scale(1.05);
        }

        .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .send-btn svg {
          width: 16px;
          height: 16px;
          color: white;
        }

        .voice-orb-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-area {
          height: 20px;
        }

        .status-text {
          color: var(--text-secondary);
          font-size: 13px;
          transition: color 0.2s;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  return (
    <TTSProviderInner>
      <ChatInterface />
    </TTSProviderInner>
  );
}
