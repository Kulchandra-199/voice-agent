'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type VADInternalState = 'silence' | 'onset' | 'speech' | 'offset';
export type VADState = 'silence' | 'speech';

/** Gate phase tracks where we are in the TTS suppression lifecycle */
type GatePhase =
  | 'open'   // VAD fully active, TTS not playing
  | 'gated'  // TTS is playing — state machine frozen, NF adapts to TTS audio
  | 'tail';  // TTS just stopped — draining reverb tail before reopening

export interface UseVADOptions {
  // ── Thresholds ──────────────────────────────────────────────────────────────
  /** SNR threshold in dB above estimated noise floor (default: 8 dB) */
  snrThresholdDb?: number;
  /** Spectral flux sensitivity (default: 0.18) */
  spectralFluxThreshold?: number;
  /** Minimum combined score to trigger speech onset (default: 0.55) */
  detectionScore?: number;

  // ── Timing ──────────────────────────────────────────────────────────────────
  /** Frames of sustained signal before speech declared (default: 4 ≈ 66 ms) */
  minSpeechFrames?: number;
  /** Frames of sustained silence before speech closed (default: 25 ≈ 417 ms) */
  minSilenceFrames?: number;
  /** Hangover frames after falling below threshold (default: 10 ≈ 166 ms) */
  hangoverFrames?: number;

  // ── TTS Echo Gate ────────────────────────────────────────────────────────────
  /**
   * Ms to wait after TTS ends before re-enabling VAD.
   * Covers speaker ring, room reverb, AGC recovery. (default: 350 ms)
   */
  ttsReleaseTailMs?: number;
  /**
   * Allow user to barge-in while TTS is playing — fires if energy is
   * significantly above the gated noise floor. (default: false)
   */
  allowBargeIn?: boolean;
  /**
   * SNR dB required for barge-in. Must be well above snrThresholdDb
   * to survive TTS bleed. (default: 18 dB)
   */
  bargeInSnrDb?: number;

  // ── Adaptive noise floor ─────────────────────────────────────────────────────
  /** Slow adaptation during speech/uncertain (default: 0.004) */
  noiseAdaptRateSlow?: number;
  /** Fast adaptation during confirmed silence (default: 0.015) */
  noiseAdaptRateFast?: number;
  /**
   * Aggressive adaptation rate while gated — NF chases TTS audio level so
   * the moment gate opens, NF is already calibrated. (default: 0.05)
   */
  noiseAdaptRateGated?: number;
  /** Pre-emphasis IIR coefficient (default: 0.97) */
  preEmphasisCoeff?: number;

  // ── Callbacks ────────────────────────────────────────────────────────────────
  onSpeechStart?: () => void;
  onSpeechEnd?: (durationMs: number) => void;
  onAudioLevel?: (info: AudioLevelInfo) => void;
}

export interface AudioLevelInfo {
  rms: number;
  speechBandEnergy: number;
  snrDb: number;
  noiseFloor: number;
  spectralFlux: number;
  score: number;
  state: VADState;
  gatePhase: GatePhase;
}

export interface UseVADReturn {
  isListening: boolean;
  isSpeechDetected: boolean;
  vadState: VADState;
  /** Expose gate phase so UI can show "Aria is speaking" vs "listening" */
  gatePhase: GatePhase;
  audioLevel: number;
  snrDb: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /**
   * Wire this into your Kokoro TTS callbacks:
   *
   *   setTTSActive(true)   — call immediately before audio.play()
   *   setTTSActive(false)  — call in audio 'ended' / onEnd handler
   *
   * The hook manages the release tail internally.
   */
  setTTSActive: (active: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FFT_SIZE  = 2048;
const SMOOTHING = 0.25;

const SPEECH_BAND_LOW_HZ  = 300;
const SPEECH_BAND_HIGH_HZ = 3000;
const NOISE_FLOOR_SEED    = 1e-5;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function hzToBin(hz: number, sr: number, fftSize: number): number {
  return Math.round((hz * fftSize) / sr);
}

function rmsSlice(data: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (end - start));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useVAD({
  snrThresholdDb        = 8,
  spectralFluxThreshold = 0.18,
  detectionScore        = 0.55,
  minSpeechFrames       = 4,
  minSilenceFrames      = 25,
  hangoverFrames        = 10,
  ttsReleaseTailMs      = 350,
  allowBargeIn          = false,
  bargeInSnrDb          = 18,
  noiseAdaptRateSlow    = 0.004,
  noiseAdaptRateFast    = 0.015,
  noiseAdaptRateGated   = 0.05,
  preEmphasisCoeff      = 0.97,
  onSpeechStart,
  onSpeechEnd,
  onAudioLevel,
}: UseVADOptions = {}): UseVADReturn {

  // ── React state ──────────────────────────────────────────────────────────────
  const [isListening,      setIsListening]      = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [vadState,         setVadState]         = useState<VADState>('silence');
  const [gatePhase,        setGatePhase]        = useState<GatePhase>('open');
  const [audioLevel,       setAudioLevel]       = useState(0);
  const [snrDb,            setSnrDb]            = useState(0);
  const [error,            setError]            = useState<string | null>(null);

  // ── Web Audio refs ────────────────────────────────────────────────────────────
  const streamRef   = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef      = useRef<number | null>(null);
  const stoppedRef  = useRef(true);

  // ── DSP refs ──────────────────────────────────────────────────────────────────
  const noiseFloorRef   = useRef(NOISE_FLOOR_SEED);
  const prevSpectrumRef = useRef<Float32Array | null>(null);
  const preEmphPrevRef  = useRef(0);

  // ── State machine refs ────────────────────────────────────────────────────────
  const internalStateRef   = useRef<VADInternalState>('silence');
  const frameCounterRef    = useRef(0);
  const hangoverCounterRef = useRef(0);
  const speechStartMsRef   = useRef(0);

  // ── TTS Gate refs ─────────────────────────────────────────────────────────────
  // gatePhaseRef is the rAF-loop source-of-truth; React state is for consumers
  const gatePhaseRef  = useRef<GatePhase>('open');
  const tailTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stable callback refs ──────────────────────────────────────────────────────
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef   = useRef(onSpeechEnd);
  const onAudioLevelRef  = useRef(onAudioLevel);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current   = onSpeechEnd;   }, [onSpeechEnd]);
  useEffect(() => { onAudioLevelRef.current  = onAudioLevel;  }, [onAudioLevel]);

  // ─────────────────────────────────────────────────────────────────────────────
  // setTTSActive
  // ─────────────────────────────────────────────────────────────────────────────

  const setTTSActive = useCallback((active: boolean) => {
    if (active) {
      // Cancel any pending tail (e.g. new utterance before previous tail expired)
      if (tailTimerRef.current) {
        clearTimeout(tailTimerRef.current);
        tailTimerRef.current = null;
      }

      gatePhaseRef.current = 'gated';
      setGatePhase('gated');

      // Close any open speech segment cleanly — Aria is taking over the turn
      if (internalStateRef.current === 'speech' || internalStateRef.current === 'offset') {
        const durationMs = performance.now() - speechStartMsRef.current;
        internalStateRef.current   = 'silence';
        frameCounterRef.current    = 0;
        hangoverCounterRef.current = 0;
        setIsSpeechDetected(false);
        setVadState('silence');
        onSpeechEndRef.current?.(durationMs);
      }

    } else {
      if (gatePhaseRef.current !== 'gated') return;

      gatePhaseRef.current = 'tail';
      setGatePhase('tail');

      tailTimerRef.current = setTimeout(() => {
        tailTimerRef.current = null;

        // Hard reset — no stale counters from TTS period carry over
        internalStateRef.current   = 'silence';
        frameCounterRef.current    = 0;
        hangoverCounterRef.current = 0;
        prevSpectrumRef.current    = null; // flush stale spectrum
        preEmphPrevRef.current     = 0;

        gatePhaseRef.current = 'open';
        setGatePhase('open');
      }, ttsReleaseTailMs);
    }
  }, [ttsReleaseTailMs]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    stoppedRef.current = true;

    if (tailTimerRef.current)  { clearTimeout(tailTimerRef.current);  tailTimerRef.current  = null; }
    if (rafRef.current)        { cancelAnimationFrame(rafRef.current); rafRef.current        = null; }
    if (audioCtxRef.current)   { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (streamRef.current)     { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }

    analyserRef.current        = null;
    prevSpectrumRef.current    = null;
    preEmphPrevRef.current     = 0;
    noiseFloorRef.current      = NOISE_FLOOR_SEED;
    internalStateRef.current   = 'silence';
    frameCounterRef.current    = 0;
    hangoverCounterRef.current = 0;
    gatePhaseRef.current       = 'open';

    setIsListening(false);
    setIsSpeechDetected(false);
    setVadState('silence');
    setGatePhase('open');
    setAudioLevel(0);
    setSnrDb(0);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Detection loop
  // ─────────────────────────────────────────────────────────────────────────────

  const runDetectionLoop = useCallback((analyser: AnalyserNode, sampleRate: number) => {
    const timeDomain = new Float32Array(FFT_SIZE);
    const freqDomain = new Float32Array(analyser.frequencyBinCount);
    const emphasized = new Float32Array(FFT_SIZE);

    const speechLow      = hzToBin(SPEECH_BAND_LOW_HZ,  sampleRate, FFT_SIZE);
    const speechHigh     = hzToBin(SPEECH_BAND_HIGH_HZ, sampleRate, FFT_SIZE);
    const speechBinCount = speechHigh - speechLow;

    const detect = () => {
      if (stoppedRef.current) return;
      rafRef.current = requestAnimationFrame(detect);

      // 1. Raw audio
      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getFloatFrequencyData(freqDomain);

      // 2. Pre-emphasis  y[n] = x[n] - α·x[n-1]
      emphasized[0] = timeDomain[0] - preEmphasisCoeff * preEmphPrevRef.current;
      for (let i = 1; i < FFT_SIZE; i++) {
        emphasized[i] = timeDomain[i] - preEmphasisCoeff * timeDomain[i - 1];
      }
      preEmphPrevRef.current = timeDomain[FFT_SIZE - 1];

      // 3. Broadband RMS (pre-emphasised)
      const broadbandRms = rmsSlice(emphasized, 0, FFT_SIZE);

      // 4. Speech-band energy
      let speechSum = 0;
      for (let b = speechLow; b < speechHigh; b++) {
        const lin = Math.pow(10, freqDomain[b] / 20);
        speechSum += lin * lin;
      }
      const speechBandEnergy = Math.sqrt(speechSum / speechBinCount);

      // 5. Adaptive noise floor
      const phase              = gatePhaseRef.current;
      const isConfirmedSilence = internalStateRef.current === 'silence';

      // While gated/tail: aggressively chase TTS audio so NF is calibrated
      // when gate opens — this is the main mechanism that kills post-TTS spikes
      const adaptRate =
        phase === 'gated' || phase === 'tail' ? noiseAdaptRateGated
        : isConfirmedSilence                  ? noiseAdaptRateFast
        :                                       noiseAdaptRateSlow;

      noiseFloorRef.current = speechBandEnergy < noiseFloorRef.current
        ? lerp(noiseFloorRef.current, speechBandEnergy, adaptRate * 2) // decay down fast
        : lerp(noiseFloorRef.current, speechBandEnergy, adaptRate);    // rise at adapt rate

      const nf = Math.max(noiseFloorRef.current, NOISE_FLOOR_SEED);

      // 6. SNR
      const currentSnrDb = 20 * Math.log10(Math.max(speechBandEnergy / nf, 1e-10));

      // 7. Spectral flux
      let spectralFlux = 0;
      if (prevSpectrumRef.current) {
        let fluxSum = 0, normSum = 0;
        const prev = prevSpectrumRef.current;
        for (let b = speechLow; b < speechHigh; b++) {
          const curr = Math.pow(10, freqDomain[b] / 20);
          const prv  = Math.pow(10, prev[b]       / 20);
          const diff = curr - prv;
          if (diff > 0) fluxSum += diff;
          normSum += curr + prv;
        }
        spectralFlux = normSum > 1e-10 ? clamp(fluxSum / normSum, 0, 1) : 0;
      }
      if (!prevSpectrumRef.current) prevSpectrumRef.current = new Float32Array(analyser.frequencyBinCount);
      prevSpectrumRef.current.set(freqDomain);

      // 8. Fused score
      const snrNorm        = clamp((currentSnrDb - snrThresholdDb) / 20 + 0.5, 0, 1);
      const fluxNorm       = clamp(spectralFlux / spectralFluxThreshold, 0, 1);
      const score          = 0.7 * snrNorm + 0.3 * fluxNorm;
      const aboveThreshold = score >= detectionScore;

      // 9. Gate + state machine
      let publicSpeech: VADState = isSpeechDetected ? 'speech' : 'silence';

      if (phase === 'gated') {
        // ── TTS playing ─────────────────────────────────────────────────────────
        if (allowBargeIn) {
          if (currentSnrDb >= bargeInSnrDb) {
            frameCounterRef.current++;
            if (frameCounterRef.current >= minSpeechFrames) {
              internalStateRef.current = 'speech';
              frameCounterRef.current  = 0;
              speechStartMsRef.current = performance.now();
              setIsSpeechDetected(true);
              setVadState('speech');
              publicSpeech = 'speech';
              onSpeechStartRef.current?.();
            }
          } else {
            frameCounterRef.current = 0;
          }
        }
        // No other transitions while gated

      } else if (phase === 'tail') {
        // ── Reverb drain window — absolute block ─────────────────────────────────
        // NF is still adapting (see step 5), state machine does nothing

      } else {
        // ── Normal VAD ───────────────────────────────────────────────────────────
        switch (internalStateRef.current) {
          case 'silence':
            if (aboveThreshold) {
              frameCounterRef.current++;
              if (frameCounterRef.current >= minSpeechFrames) {
                internalStateRef.current = 'speech';
                frameCounterRef.current  = 0;
                speechStartMsRef.current = performance.now();
                setIsSpeechDetected(true);
                setVadState('speech');
                publicSpeech = 'speech';
                onSpeechStartRef.current?.();
              }
            } else {
              frameCounterRef.current = 0;
              noiseFloorRef.current   = lerp(nf, speechBandEnergy, noiseAdaptRateFast);
            }
            break;

          case 'onset':
            break; // reserved

          case 'speech':
            if (!aboveThreshold) {
              hangoverCounterRef.current++;
              if (hangoverCounterRef.current >= hangoverFrames) {
                internalStateRef.current = 'offset';
                frameCounterRef.current  = 0;
              }
            } else {
              hangoverCounterRef.current = 0;
            }
            break;

          case 'offset':
            if (aboveThreshold) {
              internalStateRef.current   = 'speech';
              hangoverCounterRef.current = 0;
              frameCounterRef.current    = 0;
            } else {
              frameCounterRef.current++;
              if (frameCounterRef.current >= minSilenceFrames) {
                const durationMs = performance.now() - speechStartMsRef.current;
                internalStateRef.current   = 'silence';
                frameCounterRef.current    = 0;
                hangoverCounterRef.current = 0;
                setIsSpeechDetected(false);
                setVadState('silence');
                publicSpeech = 'silence';
                onSpeechEndRef.current?.(durationMs);
              }
            }
            break;
        }
      }

      // 10. UI
      setAudioLevel(clamp(broadbandRms * 20, 0, 1));
      setSnrDb(parseFloat(currentSnrDb.toFixed(1)));

      onAudioLevelRef.current?.({
        rms:              broadbandRms,
        speechBandEnergy: speechBandEnergy,
        snrDb:            currentSnrDb,
        noiseFloor:       nf,
        spectralFlux:     spectralFlux,
        score:            score,
        state:            publicSpeech,
        gatePhase:        phase,
      });
    };

    detect();
  }, [
    preEmphasisCoeff,
    noiseAdaptRateFast,
    noiseAdaptRateSlow,
    noiseAdaptRateGated,
    snrThresholdDb,
    spectralFluxThreshold,
    detectionScore,
    minSpeechFrames,
    hangoverFrames,
    minSilenceFrames,
    allowBargeIn,
    bargeInSnrDb,
    isSpeechDetected,
  ]);

  // ─────────────────────────────────────────────────────────────────────────────
  // start / stop
  // ─────────────────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setError(null);
    cleanup();
    stoppedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,  // first line of defence against speaker bleed
          noiseSuppression: true,
          autoGainControl:  true,
          channelCount:     1,
          sampleRate:       16000,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize               = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      // ✗ NOT connected to audioCtx.destination — prevents feedback

      setIsListening(true);
      runDetectionLoop(analyser, audioCtx.sampleRate);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access failed';
      setError(msg);
      cleanup();
    }
  }, [cleanup, runDetectionLoop]);

  const stop = useCallback(() => cleanup(), [cleanup]);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return {
    isListening,
    isSpeechDetected,
    vadState,
    gatePhase,
    audioLevel,
    snrDb,
    error,
    start,
    stop,
    setTTSActive,
  };
}