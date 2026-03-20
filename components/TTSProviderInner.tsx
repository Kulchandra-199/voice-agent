'use client';

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

interface TTSContextType {
  isSpeaking: boolean;
  speak: (text: string) => Promise<void>;
  voices: { name: string; lang: string }[];
  selectedVoice: string;
  setVoice: (voiceName: string) => void;
}

const TTSContext = createContext<TTSContextType | null>(null);

export function useTTS() {
  const context = useContext(TTSContext);
  if (!context) {
    throw new Error('useTTS must be used within TTSProvider');
  }
  return context;
}

const GROQ_TTS_VOICES = [
  { name: 'sage', lang: 'en' },
  { name: 'conductor', lang: 'en' },
  { name: 'puck', lang: 'en' },
];

export function TTSProviderInner({ children }: { children: ReactNode }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentVoiceName, setCurrentVoiceName] = useState<string>('sage');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const setVoice = useCallback((voiceName: string) => {
    setCurrentVoiceName(voiceName);
    localStorage.setItem('selectedTTSVoice', voiceName);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (typeof window === 'undefined') return;

    const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
    if (!apiKey) {
      console.error('[TTS] No Groq API key configured');
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(true);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'canopylabs/orpheus-v1-english',
          input: text,
          voice: currentVoiceName,
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          reject(new Error('Audio playback failed'));
        };
        audio.play();
      });
    } catch (err) {
      console.error('[TTS] Error:', err);
      setIsSpeaking(false);
    }
  }, [currentVoiceName]);

  return (
    <TTSContext.Provider
      value={{
        isSpeaking,
        speak,
        voices: GROQ_TTS_VOICES,
        selectedVoice: currentVoiceName,
        setVoice,
      }}
    >
      {children}
    </TTSContext.Provider>
  );
}