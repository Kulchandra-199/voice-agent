# Voice Agent — Voice-Powered Scheduling Assistant

Next.js frontend for **Aria**, a voice-first scheduling assistant. The UI talks to the Express backend for auth, Google Calendar (via tools), **Groq** LLM/STT/TTS, and conversation storage.

## Features

- **Voice (VAD)** — Tap the orb to open a mic session; **voice activity detection** starts and stops recording per utterance (silence ends a turn). Optional **barge-in** while the assistant is speaking (stops TTS when you talk).
- **Streaming replies** — Chat uses **SSE** from `/api/chat` (`stream: true`); tokens feed **TTS** in sentence-sized chunks for lower perceived latency.
- **Text input** — Same assistant over a text field when you switch input mode.
- **Google Calendar** — Connect Google OAuth on the backend; the model uses calendar tools for availability and booking.

## Tech stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** styled-jsx (component-scoped CSS)
- **Voice pipeline:** `useVoice.ts` (VAD + `MediaRecorder` + STT proxy), `TTSProviderInner.tsx` (chunked TTS + playback queue)
- **Chat:** `useChat.ts` (SSE parser, assistant streaming UI)

> `zustand` and `lib/ollama.ts` are present in the repo but the main app flow uses the **backend** for LLM/STT/TTS, not direct Ollama calls from the browser.

## Getting started

### Prerequisites

- Node.js 18+
- Running backend (see `../google_calendar/README.md`)

### Install

```bash
npm install
```

### Configuration

Create `.env.local` in `frontend/`:

```env
# Required — same origin as your Express API (include port)
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080

# Optional — only if you use frontend/lib/calendar.ts against the API directly
# CALENDAR_API_URL=http://localhost:8080
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
npm run build
npm start
```

## Project structure

```
frontend/
├── app/
│   ├── page.tsx           # Main chat + voice orb
│   └── login/page.tsx
├── components/
│   ├── VoiceOrb.tsx       # Mic session UI (tap to arm / mute)
│   ├── TTSProviderInner.tsx
│   ├── TTSProvider.tsx
│   └── ChatBubble.tsx
├── hooks/
│   ├── useVoice.ts        # VAD + recording + STT (primary voice logic)
│   ├── useVAD.ts          # Standalone RMS-based VAD (not wired from page)
│   └── useChat.ts         # Chat + SSE streaming
└── lib/                   # Helpers (calendar client, parsers, etc.)
```

## Environment variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_BACKEND_URL` | Base URL of the Express backend | Yes |
| `CALENDAR_API_URL` | Override for `lib/calendar.ts` only | No |

## License

MIT
