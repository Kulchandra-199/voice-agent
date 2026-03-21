'use client';

import { useState, useRef, useCallback } from 'react';

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
}

export function useVoice({ onTranscript }: UseVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Tap to talk');
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/stt`, {
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

  const startListening = useCallback(async () => {
    setError(null);
    setStatus('Recording...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        setStatus('Transcribing...');
        const blob = new Blob(chunksRef.current, { type: mimeType });
        try {
          const transcript = await transcribeWithGroq(blob, mimeType);
          if (transcript.trim()) {
            onTranscript(transcript);
          }
        } catch (err) {
          console.error('[STT] Transcription error:', err);
          setError('Failed to transcribe audio');
        }
        stream.getTracks().forEach((t) => t.stop());
        setStatus('Tap to talk');
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
    } catch (err) {
      console.error('[STT] Microphone error:', err);
      setError('Could not access microphone. Please allow microphone access.');
      setStatus('Error');
    }
  }, [onTranscript, transcribeWithGroq]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    setStatus('Tap to talk');
  }, []);

  return {
    isListening,
    isProcessing,
    status,
    error,
    startListening,
    stopListening,
    clearError: () => {
      setError(null);
      setStatus('Tap to talk');
    },
  };
}
