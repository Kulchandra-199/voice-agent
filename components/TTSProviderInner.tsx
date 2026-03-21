'use client';

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

interface TTSContextType {
  isSpeaking: boolean;
  speak: (text: string) => Promise<void>;
  speakStream: (chunks: AsyncIterable<string>) => Promise<void>;
  stopSpeaking: () => void;
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
  { name: 'autumn', lang: 'en' },
  { name: 'diana', lang: 'en' },
  { name: 'hannah', lang: 'en' },
  { name: 'austin', lang: 'en' },
  { name: 'daniel', lang: 'en' },
  { name: 'troy', lang: 'en' },
];

export function TTSProviderInner({ children }: { children: ReactNode }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentVoiceName, setCurrentVoiceName] = useState<string>('autumn');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stopFlagRef = useRef(false);
  const pendingFetchesRef = useRef<AbortController[]>([]);
  const textBufferRef = useRef('');
  const chunksQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  const setVoice = useCallback((voiceName: string) => {
    const validVoices = GROQ_TTS_VOICES.map(v => v.name);
    if (validVoices.includes(voiceName)) {
      setCurrentVoiceName(voiceName);
      localStorage.setItem('selectedTTSVoice', voiceName);
    }
  }, []);

  function playNextInQueue() {
    if (stopFlagRef.current) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    const next = chunksQueueRef.current.shift();
    if (!next) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    const ctx = audioContextRef.current!;
    const source = ctx.createBufferSource();
    source.buffer = next;
    source.connect(ctx.destination);

    if (pendingSourceRef.current) {
      try { pendingSourceRef.current.stop(); } catch {}
    }
    pendingSourceRef.current = source;
    isPlayingRef.current = true;

    source.start();
    source.onended = () => {
      if (stopFlagRef.current) {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        return;
      }
      playNextInQueue();
    };
  }

  function queueChunk(buffer: AudioBuffer) {
    if (!isPlayingRef.current) {
      chunksQueueRef.current.push(buffer);
      playNextInQueue();
    } else {
      chunksQueueRef.current.push(buffer);
    }
  }

  async function fetchAudioChunk(text: string, voice: string): Promise<AudioBuffer | null> {
    const controller = new AbortController();
    pendingFetchesRef.current.push(controller);

    try {
      let response;
      try {
        response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        console.error('[TTS] fetchAudioChunk: network error:', fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
        return null;
      }

      pendingFetchesRef.current = pendingFetchesRef.current.filter(c => c !== controller);

      if (!response.ok || stopFlagRef.current) {
        const errText = await response.text().catch(() => 'unknown');
        console.error('[TTS] fetchAudioChunk: TTS request failed:', response.status, errText);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (stopFlagRef.current) return null;

      const ctx = audioContextRef.current || new AudioContext();
      audioContextRef.current = ctx;
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      return buffer;
    } catch (err: unknown) {
      pendingFetchesRef.current = pendingFetchesRef.current.filter(c => c !== controller);
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      console.error('[TTS] Chunk fetch error:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  const stopSpeaking = useCallback(() => {
    stopFlagRef.current = true;
    pendingFetchesRef.current.forEach(c => c.abort());
    pendingFetchesRef.current = [];
    chunksQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioContextRef.current && pendingSourceRef.current) {
      try { pendingSourceRef.current.stop(); } catch {}
      pendingSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (typeof window === 'undefined') return;

    stopSpeaking();
    setIsSpeaking(true);
    stopFlagRef.current = false;

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: currentVoiceName }),
      });

      if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
      if (stopFlagRef.current) { setIsSpeaking(false); return; }

      const audioBlob = await response.blob();
      if (stopFlagRef.current) { setIsSpeaking(false); return; }

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
  }, [currentVoiceName, stopSpeaking]);

  const speakStream = useCallback(async (chunks: AsyncIterable<string>): Promise<void> => {
    if (typeof window === 'undefined') return;

    stopSpeaking();
    setIsSpeaking(true);
    stopFlagRef.current = false;
    textBufferRef.current = '';
    chunksQueueRef.current = [];
    isPlayingRef.current = false;

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    for await (const text of chunks) {
      if (stopFlagRef.current) break;
      textBufferRef.current += text;

      const shouldFlush =
        /[.!?]\s*$/.test(textBufferRef.current) ||
        textBufferRef.current.split(/\s+/).length >= 3;

      if (shouldFlush && textBufferRef.current.trim()) {
        const chunkText = textBufferRef.current.trim();
        textBufferRef.current = '';
        const buf = await fetchAudioChunk(chunkText, currentVoiceName);
        if (stopFlagRef.current) break;
        if (!buf) break;
        queueChunk(buf);
      }
    }

    if (!stopFlagRef.current && textBufferRef.current.trim()) {
      const chunkText = textBufferRef.current.trim();
      textBufferRef.current = '';
      const buf = await fetchAudioChunk(chunkText, currentVoiceName);
      if (stopFlagRef.current) return;
      if (buf) queueChunk(buf);
    }
  }, [currentVoiceName, stopSpeaking]);

  return (
    <TTSContext.Provider
      value={{
        isSpeaking,
        speak,
        speakStream,
        stopSpeaking,
        voices: GROQ_TTS_VOICES,
        selectedVoice: currentVoiceName,
        setVoice,
      }}
    >
      {children}
    </TTSContext.Provider>
  );
}
