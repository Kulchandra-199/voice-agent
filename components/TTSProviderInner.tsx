'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';

interface TTSContextType {
  isSpeaking: boolean;
  speak: (text: string) => Promise<void>;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setVoice: (voice: SpeechSynthesisVoice) => void;
}

const TTSContext = createContext<TTSContextType | null>(null);

export function useTTS() {
  const context = useContext(TTSContext);
  if (!context) {
    throw new Error('useTTS must be used within TTSProvider');
  }
  return context;
}

export function TTSProviderInner({ children }: { children: ReactNode }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [currentVoiceName, setCurrentVoiceName] = useState<string>('');
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const currentVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Load voices and set from localStorage
  useEffect(() => {
    const loadVoices = () => {
      const allVoices = speechSynthesis.getVoices();
      if (allVoices.length === 0) return;

      voicesRef.current = allVoices;
      setVoices(allVoices);

      // Get saved voice name from localStorage
      const savedVoiceName = localStorage.getItem('selectedVoice');
      let selectedVoice: SpeechSynthesisVoice | null = null;

      if (savedVoiceName) {
        selectedVoice = allVoices.find(v => v.name === savedVoiceName) || null;
      }

      // Only set default if no saved voice
      if (!selectedVoice) {
        selectedVoice = allVoices.find(
          (v) => v.lang.startsWith('en') && v.name.includes('Female') && v.name.includes('Google')
        ) || allVoices.find(
          (v) => v.lang.startsWith('en') && v.name.includes('Female')
        ) || allVoices.find((v) => v.lang.startsWith('en'))
        || (allVoices.length > 0 ? allVoices[0] : null);
      }

      if (selectedVoice) {
        currentVoiceRef.current = selectedVoice;
        setCurrentVoiceName(selectedVoice.name);
      }
    };

    loadVoices();

    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const setVoice = useCallback((voice: SpeechSynthesisVoice) => {
    currentVoiceRef.current = voice;
    setCurrentVoiceName(voice.name);
    localStorage.setItem('selectedVoice', voice.name);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (typeof window === 'undefined') return;

    speechSynthesis.cancel();

    // Get voice from ref to avoid stale closure issues
    const voice = currentVoiceRef.current;
    console.log('[TTS] Speaking with voice:', voice?.name);

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);

      // Always set the voice explicitly
      if (voice) {
        utterance.voice = voice;
      }

      utterance.rate = 1.15;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = (err) => {
        console.error('[TTS] Error:', err);
        setIsSpeaking(false);
        resolve();
      };

      speechSynthesis.speak(utterance);
    });
  }, []);

  const selectedVoice = voices.find(v => v.name === currentVoiceName) || null;

  return (
    <TTSContext.Provider value={{ isSpeaking, speak, voices, selectedVoice, setVoice }}>
      {children}
    </TTSContext.Provider>
  );
}