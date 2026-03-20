'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseVADOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  threshold?: number;           // Energy threshold (0-1, default 0.03)
  minSpeechDurationMs?: number; // Min ms of speech above threshold to trigger start (default 200)
  minSilenceDurationMs?: number; // Min ms of silence below threshold to trigger end (default 400)
}

export function useVAD({
  onSpeechStart,
  onSpeechEnd,
  threshold = 0.03,
  minSpeechDurationMs = 200,
  minSilenceDurationMs = 400,
}: UseVADOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  // Refs for speech detection state
  const speechStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);
  const isInSpeechRef = useRef(false);

  // Keep latest callbacks in refs so the detection loop always calls the newest
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current = onSpeechEnd; }, [onSpeechEnd]);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    analyserRef.current = null;
    setIsListening(false);
    setIsSpeechDetected(false);
    isInSpeechRef.current = false;
    speechStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    cleanup();
    stoppedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;

      // Use MediaStreamAudioSourceNode + AnalyserNode — no deprecated APIs
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      // Do NOT connect to destination (avoids feedback)

      setIsListening(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      const detect = () => {
        if (stoppedRef.current) return;
        rafRef.current = requestAnimationFrame(detect);

        analyser.getFloatTimeDomainData(dataArray);

        // Compute RMS energy
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          sum += val * val;
        }
        const rms = Math.sqrt(sum / bufferLength);

        const now = performance.now();

        if (rms > threshold) {
          // Above threshold — speech
          silenceStartTimeRef.current = null;
          if (!isInSpeechRef.current) {
            if (speechStartTimeRef.current === null) {
              speechStartTimeRef.current = now;
            } else if (now - speechStartTimeRef.current >= minSpeechDurationMs) {
              isInSpeechRef.current = true;
              setIsSpeechDetected(true);
              onSpeechStartRef.current?.();
            }
          }
        } else {
          // Below threshold — silence
          speechStartTimeRef.current = null;
          if (isInSpeechRef.current) {
            if (silenceStartTimeRef.current === null) {
              silenceStartTimeRef.current = now;
            } else if (now - silenceStartTimeRef.current >= minSilenceDurationMs) {
              isInSpeechRef.current = false;
              setIsSpeechDetected(false);
              onSpeechEndRef.current?.();
              silenceStartTimeRef.current = null;
            }
          }
        }
      };

      detect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access failed';
      setError(msg);
      cleanup();
    }
  }, [cleanup, threshold, minSpeechDurationMs, minSilenceDurationMs]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    isListening,
    isSpeechDetected,
    error,
    start,
    stop,
  };
}
