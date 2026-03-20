'use client';

import { useState, useRef, useCallback } from 'react';

function encodeWav(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = 1;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const samples = audioBuffer.length;
  const dataSize = samples * numChannels * (bitDepth / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = audioBuffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
}

export function useVoice({ onTranscript }: UseVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Tap to talk');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isSpeechRecognitionSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startBrowserSTT = useCallback(() => {
    console.log('[STT] Starting browser speech recognition...');
    setStatus('Starting...');
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('[STT] Speech recognition not supported');
      setError('Speech recognition not supported in this browser');
      setStatus('Not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[STT] Browser speech recognition started');
      setIsListening(true);
      setStatus('Listening...');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        setStatus(`Hearing: ${interimTranscript}`);
      }

      if (finalTranscript.trim()) {
        console.log('[STT] Got transcript:', finalTranscript.trim());
        setStatus('Processing...');
        setIsProcessing(true);
        onTranscript(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[STT] Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        setError(`Speech recognition error: ${event.error}`);
        setStatus('Error');
      }
    };

    recognition.onend = () => {
      console.log('[STT] Browser speech recognition ended');
      setIsListening(false);
      setIsProcessing(false);
      if (!error) {
        setStatus('Tap to talk');
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error('[STT] Failed to start recognition:', err);
      setError('Failed to start speech recognition');
      setStatus('Error');
    }
  }, [onTranscript, error]);

  const stopBrowserSTT = useCallback(() => {
    console.log('[STT] Stopping browser speech recognition');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsProcessing(false);
    setStatus('Tap to talk');
  }, []);

  const transcribeWithGroq = useCallback(async (audioBlob: Blob): Promise<string> => {
    console.log('[STT] Transcribing with Groq...');
    const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;

    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'en');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Transcription failed: ${res.status}`);
    }

    const data = await res.json();
    console.log('[STT] Groq transcription result:', data.text);
    return data.text ?? '';
  }, []);

  const transcribeWithVoicegain = useCallback(async (base64Audio: string): Promise<string> => {
    console.log('[STT] Transcribing with Voicegain...');

    const response = await fetch('/api/stt/voicegain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64Audio }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    return data.transcript ?? '';
  }, []);

  const startRecordingWithGroq = useCallback(async () => {
    console.log('[STT] Starting Groq recording...');
    setError(null);
    setStatus('Recording...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        console.log('[STT] Recording stopped, transcribing...');
        setStatus('Transcribing...');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
          const transcript = await transcribeWithGroq(blob);
          if (transcript.trim()) {
            onTranscript(transcript);
          }
        } catch (err) {
          console.error('[STT] Transcription error:', err);
          setError('Failed to transcribe audio');
        }
        stream.getTracks().forEach((t) => t.stop());
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

  const stopRecordingWithGroq = useCallback(() => {
    console.log('[STT] Stopping Groq recording');
    mediaRecorderRef.current?.stop();
    setIsListening(false);
  }, []);

  const startRecordingWithVoicegain = useCallback(async () => {
    console.log('[STT] Starting Voicegain recording...');
    setError(null);
    setStatus('Recording...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        console.log('[STT] Recording stopped, converting to WAV...');
        setStatus('Transcribing...');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioContext = new AudioContext({ sampleRate: 16000 });
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const wavBytes = encodeWav(audioBuffer);
          let binary = '';
          for (let i = 0; i < wavBytes.length; i++) {
            binary += String.fromCharCode(wavBytes[i]);
          }
          const base64Audio = btoa(binary);
          audioContext.close();

          const transcript = await transcribeWithVoicegain(base64Audio);
          if (transcript.trim()) {
            onTranscript(transcript);
          }
        } catch (err) {
          console.error('[STT] Transcription error:', err);
          setError('Failed to transcribe audio');
        }
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
    } catch (err) {
      console.error('[STT] Microphone error:', err);
      setError('Could not access microphone. Please allow microphone access.');
      setStatus('Error');
    }
  }, [onTranscript, transcribeWithVoicegain]);

  const stopRecordingWithVoicegain = useCallback(() => {
    console.log('[STT] Stopping Voicegain recording');
    mediaRecorderRef.current?.stop();
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    console.log('[STT] startListening called');
    setError(null);

    const sttProvider = process.env.NEXT_PUBLIC_STT_PROVIDER;
    console.log('[STT] STT Provider:', sttProvider || 'browser (default)');

    if (sttProvider === 'voicegain') {
      startRecordingWithVoicegain();
      return;
    }

    if (sttProvider === 'groq') {
      startRecordingWithGroq();
      return;
    }

    const hasGroqKey = !!process.env.NEXT_PUBLIC_GROQ_API_KEY;

    if (hasGroqKey) {
      startRecordingWithGroq();
    } else if (isSpeechRecognitionSupported) {
      startBrowserSTT();
    } else {
      setError('No Speech-to-Text service available. Configure STT_PROVIDER, GROQ_API_KEY, or use Chrome/Edge.');
      setStatus('Not available');
    }
  }, [isSpeechRecognitionSupported, startBrowserSTT, startRecordingWithGroq, startRecordingWithVoicegain]);

  const stopListening = useCallback(() => {
    console.log('[STT] stopListening called');
    const sttProvider = process.env.NEXT_PUBLIC_STT_PROVIDER;

    if (sttProvider === 'voicegain') {
      stopRecordingWithVoicegain();
    } else if (sttProvider === 'groq' || process.env.NEXT_PUBLIC_GROQ_API_KEY) {
      stopRecordingWithGroq();
    } else {
      stopBrowserSTT();
    }
    setStatus('Tap to talk');
  }, [stopBrowserSTT, stopRecordingWithGroq, stopRecordingWithVoicegain]);

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
