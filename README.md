
readme
=======
# Voice Agent - Voice-Powered Scheduling Assistant

A voice-enabled AI assistant that interacts with users via speech and manages their Google Calendar. Built with Next.js, it connects to a backend scheduler service for calendar operations and LLM-powered conversations.

## Features

- **Voice Interaction** - Speak naturally to schedule meetings and manage calendar
- **Text Input** - Alternative text-based interface for all commands
- **Google Calendar Integration** - View, create, and cancel meetings
- **AI-Powered** - Natural language understanding via Ollama LLM
- **Google Meet Links** - Automatic meeting link generation for events

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **State Management**: Zustand
- **Styling**: CSS-in-JS (styled-jsx)
- **LLM**: Ollama Cloud API
- **Backend**: Scheduler Backend API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Configuration

Create a `.env.local` file in the root directory:

```env
# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
CALENDAR_API_URL=http://localhost:8080

# Ollama Cloud (optional - for local development)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=glm-5
OLLAMA_CLOUD_API_KEY=your_api_key
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start.

### Build

```bash
npm run build
```

## Project Structure

```
frontend/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Main chat interface
│   └── login/page.tsx     # Login page
├── components/            # React components
│   ├── VoiceOrb.tsx       # Voice input orb
│   ├── ChatBubble.tsx     # Chat message bubbles
│   └── TTSProvider.tsx    # Text-to-Speech
├── hooks/                  # Custom React hooks
│   ├── useVoice.ts        # Voice recognition
│   └── useChat.ts         # Chat functionality
└── lib/                    # Utility functions
    ├── calendar.ts        # Calendar API client
    ├── ollama.ts          # LLM API client
    └── tokens.ts          # OAuth token management
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_BACKEND_URL` | Backend API URL | Yes |
| `CALENDAR_API_URL` | Calendar API URL | Yes |
| `OLLAMA_BASE_URL` | Ollama API base URL | Yes |
| `OLLAMA_MODEL` | Ollama model name | Yes |
| `OLLAMA_CLOUD_API_KEY` | Ollama Cloud API key | Yes |

## License

MIT
>>>>>>> d6e9f71 (Add README documentation)
