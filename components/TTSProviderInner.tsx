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

  // All refs declared BEFORE any function that uses them
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stopFlagRef = useRef(false);
  const pendingFetchesRef = useRef<AbortController[]>([]);
  const textBufferRef = useRef('');
  const chunksQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const TTS_CHUNK_SIZE = 15;

  const setVoice = useCallback((voiceName: string) => {
    const validVoices = GROQ_TTS_VOICES.map(v => v.name);
    if (validVoices.includes(voiceName)) {
      setCurrentVoiceName(voiceName);
      localStorage.setItem('selectedTTSVoice', voiceName);
    }
  }, []);

  // ---- Internal helpers (declared before stopSpeaking) ----

  function playNextInQueue() {
    console.log('[TTS] playNextInQueue: called, stopFlag:', stopFlagRef.current, 'queue length:', chunksQueueRef.current.length);
    if (stopFlagRef.current) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      console.log('[TTS] playNextInQueue: stopped by flag');
      return;
    }
    const next = chunksQueueRef.current.shift();
    console.log('[TTS] playNextInQueue: shifted buffer, remaining queue:', chunksQueueRef.current.length, 'buffer duration:', next?.duration);
    if (!next) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      console.log('[TTS] playNextInQueue: queue empty, set isSpeaking false');
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
      console.log('[TTS] playNextInQueue: source ended');
      if (stopFlagRef.current) {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        return;
      }
      playNextInQueue();
    };
  }

  function queueChunk(buffer: AudioBuffer) {
    console.log('[TTS] queueChunk: buffer duration:', buffer.duration, 'isPlaying:', isPlayingRef.current, 'queue before:', chunksQueueRef.current.length);
    if (!isPlayingRef.current) {
      chunksQueueRef.current.push(buffer);
      console.log('[TTS] queueChunk: not playing, pushed and calling playNextInQueue');
      playNextInQueue();
    } else {
      chunksQueueRef.current.push(buffer);
      console.log('[TTS] queueChunk: currently playing, queued');
    }
  }

  async function fetchAudioChunk(text: string, voice: string): Promise<AudioBuffer | null> {
    console.log('[TTS] fetchAudioChunk: ENTERED function, text:', text, 'voice:', voice);
    const controller = new AbortController();
    pendingFetchesRef.current.push(controller);

    try {
      console.log('[TTS] fetchAudioChunk: fetching TTS for text:', text.substring(0, 50), 'voice:', voice);
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

      console.log('[TTS] fetchAudioChunk: response status:', response.status, 'ok:', response.ok, 'content-type:', response.headers.get('content-type'));
      if (!response.ok || stopFlagRef.current) {
        const errText = await response.text().catch(() => 'unknown');
        console.error('[TTS] fetchAudioChunk: TTS request failed:', response.status, errText);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      console.log('[TTS] fetchAudioChunk: received audio buffer size:', arrayBuffer.byteLength);
      if (stopFlagRef.current) return null;

      const ctx = audioContextRef.current || new AudioContext();
      audioContextRef.current = ctx;
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      console.log('[TTS] fetchAudioChunk: decoded audio buffer, duration:', buffer.duration);
      return buffer;
    } catch (err: unknown) {
      pendingFetchesRef.current = pendingFetchesRef.current.filter(c => c !== controller);
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[TTS] fetchAudioChunk: aborted');
        return null;
      }
      console.error('[TTS] Chunk fetch error:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  // ---- stopSpeaking ----

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

  // ---- speak (non-streaming) ----

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

  // ---- speakStream (streaming) ----

  const speakStream = useCallback(async (chunks: AsyncIterable<string>): Promise<void> => {
    if (typeof window === 'undefined') return;

    console.log('[TTS] speakStream: starting');
    stopSpeaking();
    setIsSpeaking(true);
    stopFlagRef.current = false;
    textBufferRef.current = '';
    chunksQueueRef.current = [];
    isPlayingRef.current = false;

    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    console.log('[TTS] speakStream: AudioContext created, state:', ctx.state);

    if (ctx.state === 'suspended') {
      console.log('[TTS] speakStream: resuming AudioContext');
      await ctx.resume();
    }

    let chunkCount = 0;
    for await (const text of chunks) {
      chunkCount++;
      console.log('[TTS] speakStream: received chunk', chunkCount, ':', text.substring(0, 80));
      if (stopFlagRef.current) {
        console.log('[TTS] speakStream: stopped before processing');
        break;
      }
      textBufferRef.current += text;

      const shouldFlush =
        /[.!?]\s*$/.test(textBufferRef.current) ||
        textBufferRef.current.split(/\s+/).length >= 3;

      if (shouldFlush && textBufferRef.current.trim()) {
        const chunkText = textBufferRef.current.trim();
        textBufferRef.current = '';
        console.log('[TTS] speakStream: flushing chunk:', chunkText, 'voice:', currentVoiceName);
        let buf: AudioBuffer | null = null;
        try {
          console.log('[TTS] speakStream: about to call fetchAudioChunk');
          buf = await fetchAudioChunk(chunkText, currentVoiceName);
          console.log('[TTS] speakStream: fetchAudioChunk returned:', buf ? `buffer(dur=${buf.duration})` : 'null');
        } catch(e: unknown) {
          console.error('[TTS] speakStream: fetchAudioChunk threw:', e instanceof Error ? e.message : String(e), e instanceof Error ? e.stack?.split('\n')[1] : '');
        }
        if (stopFlagRef.current) {
          console.log('[TTS] speakStream: stopped after fetch');
          break;
        }
        if (!buf) {
          console.log('[TTS] speakStream: no buffer, breaking');
          break;
        }
        queueChunk(buf);
      }
    }

    console.log('[TTS] speakStream: finished receiving chunks, count:', chunkCount);
    // Flush remaining
    if (!stopFlagRef.current && textBufferRef.current.trim()) {
      const chunkText = textBufferRef.current.trim();
      console.log('[TTS] speakStream: flushing final chunk:', chunkText.substring(0, 50));
      textBufferRef.current = '';
      const buf = await fetchAudioChunk(chunkText, currentVoiceName);
      console.log('[TTS] speakStream: final fetchAudioChunk returned:', buf ? `buffer(dur=${buf.duration})` : 'null');
      if (stopFlagRef.current) return;
      if (buf) queueChunk(buf);
    }
    console.log('[TTS] speakStream: complete, queue length:', chunksQueueRef.current.length);
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
