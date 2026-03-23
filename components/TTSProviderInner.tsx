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

/** Pull stable speech-sized phrases from a growing buffer (sentence-first, then comma pauses, then max length). */
const SEM_MIN = 10;
const SEM_COMMA_MIN_BEFORE = 28;
const SEM_MAX = 200;

function extractSemanticChunks(buffer: string): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  while (rest.length > 0) {
    const trimmed = rest.trimStart();
    if (!trimmed) {
      rest = '';
      break;
    }
    const leadWs = rest.length - trimmed.length;

    const sentence = trimmed.match(/^([\s\S]{3,}?[.!?])(\s+|$)/);
    if (sentence) {
      const raw = sentence[1].trim();
      if (raw.length >= 3) {
        chunks.push(raw);
        rest = rest.slice(leadWs + sentence[1].length).replace(/^\s+/, '');
        continue;
      }
    }

    if (trimmed.length >= SEM_COMMA_MIN_BEFORE) {
      const commaAt = trimmed.indexOf(',');
      if (commaAt >= SEM_COMMA_MIN_BEFORE - 1 && commaAt < trimmed.length - 1) {
        const after = trimmed[commaAt + 1];
        if (after === ' ' || after === '\n') {
          const piece = trimmed.slice(0, commaAt + 1).trim();
          if (piece.length >= SEM_MIN) {
            chunks.push(piece);
            rest = rest.slice(leadWs + commaAt + 1).replace(/^\s+/, '');
            continue;
          }
        }
      }
    }

    if (trimmed.length >= SEM_MAX) {
      const slice = trimmed.slice(0, SEM_MAX);
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace >= SEM_MIN) {
        chunks.push(trimmed.slice(0, lastSpace).trim());
        rest = rest.slice(leadWs + lastSpace).replace(/^\s+/, '');
        continue;
      }
      chunks.push(trimmed.slice(0, SEM_MAX).trim());
      rest = rest.slice(leadWs + SEM_MAX).replace(/^\s+/, '');
      continue;
    }

    break;
  }
  return { chunks, rest };
}

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
  const ttsTextQueueRef = useRef<string[]>([]);
  const ttsSynthInFlightRef = useRef(0);
  const TTS_SYNTH_PARALLEL = 2;

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
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';
      try {
        response = await fetch(`${backendUrl}/api/tts`, {
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
    ttsTextQueueRef.current = [];
    ttsSynthInFlightRef.current = 0;
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
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';
      const response = await fetch(`${backendUrl}/api/tts`, {
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
    ttsTextQueueRef.current = [];
    ttsSynthInFlightRef.current = 0;
    isPlayingRef.current = false;

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const voice = currentVoiceName;

    const pumpSynth = () => {
      while (
        !stopFlagRef.current &&
        ttsSynthInFlightRef.current < TTS_SYNTH_PARALLEL &&
        ttsTextQueueRef.current.length > 0
      ) {
        const phrase = ttsTextQueueRef.current.shift();
        if (!phrase?.trim()) continue;
        ttsSynthInFlightRef.current += 1;
        void fetchAudioChunk(phrase.trim(), voice).then((buf) => {
          ttsSynthInFlightRef.current -= 1;
          if (!stopFlagRef.current && buf) {
            queueChunk(buf);
          }
          pumpSynth();
        });
      }
    };

    const enqueueTtsPhrase = (phrase: string) => {
      const t = phrase.trim();
      if (!t) return;
      ttsTextQueueRef.current.push(t);
      pumpSynth();
    };

    for await (const text of chunks) {
      if (stopFlagRef.current) break;
      textBufferRef.current += text;
      const { chunks: ready, rest } = extractSemanticChunks(textBufferRef.current);
      textBufferRef.current = rest;
      for (const phrase of ready) {
        if (stopFlagRef.current) break;
        enqueueTtsPhrase(phrase);
      }
    }

    if (!stopFlagRef.current && textBufferRef.current.trim()) {
      enqueueTtsPhrase(textBufferRef.current.trim());
      textBufferRef.current = '';
    }

    const waitForSynthDrain = () =>
      new Promise<void>((resolve) => {
        const tick = () => {
          if (stopFlagRef.current) {
            resolve();
            return;
          }
          if (ttsSynthInFlightRef.current === 0 && ttsTextQueueRef.current.length === 0) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });

    await waitForSynthDrain();
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
