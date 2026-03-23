'use client';

import { useState, useRef, useCallback, useEffect, type MutableRefObject } from 'react';

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  /** True while assistant TTS is playing — used to trigger barge-in instead of only capture. */
  isSpeakingRef?: MutableRefObject<boolean>;
  /** Stop TTS / abort reply when user speaks during playback. */
  onBargeIn?: () => void;
  threshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
}

export function useVoice({
  onTranscript,
  isSpeakingRef,
  onBargeIn,
  threshold = 0.03,
  minSpeechDurationMs = 200,
  minSilenceDurationMs = 1000,
}: UseVoiceOptions) {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isCapturingSpeech, setIsCapturingSpeech] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Tap to start listening');
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm');
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(true);

  const chunksRef = useRef<Blob[]>([]);
  const speechStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeValueRef = useRef<number | null>(null);
  const isInSpeechRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const discardNextTranscriptRef = useRef(false);

  const onTranscriptRef = useRef(onTranscript);
  const onBargeInRef = useRef(onBargeIn);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onBargeInRef.current = onBargeIn;
  }, [onBargeIn]);

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const transcribeWithGroq = useCallback(async (audioBlob: Blob, mimeType: string): Promise<string> => {
    const base64 = await blobToBase64(audioBlob);
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

    const res = await fetch(`${backendUrl}/api/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, language: 'en', mimeType }),
    });

    if (!res.ok) {
      throw new Error(`Transcription failed: ${res.status}`);
    }

    const data = await res.json();
    return data.text ?? '';
  }, []);

  const startRecorderSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || isTranscribingRef.current) return;
    if (mediaRecorderRef.current?.state === 'recording') return;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/ogg';
    mimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      setIsCapturingSpeech(false);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      mediaRecorderRef.current = null;

      if (discardNextTranscriptRef.current) {
        discardNextTranscriptRef.current = false;
        isInSpeechRef.current = false;
        speechStartTimeRef.current = null;
        silenceStartTimeValueRef.current = null;
        isTranscribingRef.current = false;
        setStatus(stoppedRef.current ? 'Tap to start listening' : 'Listening — speak when ready');
        return;
      }

      if (blob.size < 256) {
        isTranscribingRef.current = false;
        setStatus(stoppedRef.current ? 'Tap to start listening' : 'Listening — speak when ready');
        return;
      }

      setIsProcessing(true);
      isTranscribingRef.current = true;
      setStatus('Transcribing...');
      try {
        const transcript = await transcribeWithGroq(blob, mimeType);
        if (transcript.trim()) {
          onTranscriptRef.current(transcript);
        }
      } catch (err) {
        console.error('[STT] Transcription error:', err);
        setError('Failed to transcribe audio');
      } finally {
        setIsProcessing(false);
        isTranscribingRef.current = false;
        isInSpeechRef.current = false;
        speechStartTimeRef.current = null;
        silenceStartTimeValueRef.current = null;
        if (!stoppedRef.current) {
          setStatus('Listening — speak when ready');
        } else {
          setStatus('Tap to start listening');
        }
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsCapturingSpeech(true);
    setStatus('Listening...');
  }, [transcribeWithGroq]);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.stop();
    }
    mediaRecorderRef.current = null;

    const ctx = audioContextRef.current;
    const stream = streamRef.current;
    audioContextRef.current = null;
    streamRef.current = null;
    analyserRef.current = null;

    setTimeout(() => {
      if (ctx) ctx.close().catch(() => {});
      if (stream) stream.getTracks().forEach((t) => t.stop());
    }, 120);

    setIsSessionActive(false);
    setIsCapturingSpeech(false);
    isInSpeechRef.current = false;
    speechStartTimeRef.current = null;
    silenceStartTimeValueRef.current = null;
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    discardNextTranscriptRef.current = false;
    cleanup();
    stoppedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsSessionActive(true);
      setStatus('Listening — speak when ready');

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      const detect = () => {
        if (stoppedRef.current) return;
        rafRef.current = requestAnimationFrame(detect);

        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          sum += val * val;
        }
        const rms = Math.sqrt(sum / bufferLength);
        const now = performance.now();

        if (rms > threshold) {
          silenceStartTimeValueRef.current = null;
          if (!isInSpeechRef.current) {
            if (speechStartTimeRef.current === null) {
              speechStartTimeRef.current = now;
            } else if (now - speechStartTimeRef.current >= minSpeechDurationMs) {
              if (isSpeakingRef?.current) {
                onBargeInRef.current?.();
              }
              if (!isTranscribingRef.current) {
                isInSpeechRef.current = true;
                speechStartTimeRef.current = null;
                startRecorderSegment();
              }
            }
          }
        } else {
          speechStartTimeRef.current = null;
          if (isInSpeechRef.current) {
            if (silenceStartTimeValueRef.current === null) {
              silenceStartTimeValueRef.current = now;
            } else if (now - silenceStartTimeValueRef.current >= minSilenceDurationMs) {
              isInSpeechRef.current = false;
              silenceStartTimeValueRef.current = null;
              if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
              }
            }
          }
        }
      };

      detect();
    } catch (err) {
      console.error('[STT] Microphone error:', err);
      setError('Could not access microphone. Please allow microphone access.');
      setStatus('Error');
      cleanup();
    }
  }, [cleanup, threshold, minSpeechDurationMs, minSilenceDurationMs, startRecorderSegment, isSpeakingRef]);

  const stopSession = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec?.state === 'recording') {
      discardNextTranscriptRef.current = true;
    }
    cleanup();
    setStatus('Tap to start listening');
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isSessionActive,
    isCapturingSpeech,
    /** @deprecated use isSessionActive — kept for minimal page churn */
    isListening: isSessionActive,
    isProcessing,
    status,
    error,
    startSession,
    stopSession,
    /** @deprecated use startSession */
    startListening: startSession,
    /** @deprecated use stopSession */
    stopListening: stopSession,
    clearError: () => {
      setError(null);
      setStatus(isSessionActive ? 'Listening — speak when ready' : 'Tap to start listening');
    },
  };
}
