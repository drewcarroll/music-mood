# 🎵 Music Mood

Generate **real-time music that matches your mood**. Describe how you feel,
and Music Mood translates that into weighted music prompts, streams generated
audio from Google's **Lyria RealTime** model via **@google/genai**, and plays it
back gaplessly through the **Web Audio API**, an **AudioWorklet**, and **Tone.js**.

You can steer the mood live — Lyria RealTime keeps the same stream playing and
smoothly transitions toward the new prompts.

---

## Tech Stack

| Concern              | Technology                          |
| -------------------- | ----------------------------------- |
| UI                   | React + TypeScript                  |
| Build / dev server   | Vite                                |
| Music generation     | Lyria RealTime via `@google/genai`  |
| Audio playback       | Web Audio API + AudioWorklet        |
| Audio graph / effects| Tone.js                             |
| Linting / formatting | ESLint + Prettier                   |

---

## Getting Started

### 1. Prerequisites

- Node.js **>= 18** (a `.nvmrc` pins Node 20)
- A Google AI / Gemini API key with access to Lyria RealTime
  → get one at <https://aistudio.google.com/apikey>

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your API key

```bash
cp .env.example .env
# then edit .env and set VITE_GEMINI_API_KEY
```

### 4. Run the dev server

```bash
npm run dev
```

Open the printed URL, choose a mood, and click **Generate**.
(Audio requires a user gesture to start — the AudioContext resumes on click.)

### Available scripts

| Script                | Description                          |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Start the Vite dev server            |
| `npm run build`       | Type-check and build for production  |
| `npm run preview`     | Preview the production build         |
| `npm run lint`        | Run ESLint (enforces layer rules)    |
| `npm run format`      | Format the codebase with Prettier    |
| `npm run typecheck`   | Type-check without emitting          |

---

## Clean Architecture

This project follows **Clean Architecture**. Dependencies point **inward only**:

```
interfaces  ─┐
             ├─►  application  ─►  domain
infrastructure ─┘
```

- `domain/` imports **nothing** from outside itself.
- `application/` imports only from `domain/`.
- `infrastructure/` implements interfaces declared in `domain/` / `application/`.
- `interfaces/` orchestrates use cases and never touches `infrastructure/` directly.

### Layer responsibilities

#### `src/domain/` — the business core (zero dependencies)
- **Entities** — `MusicSession` (lifecycle: idle → playing → paused → stopped,
  protects its own invariants, derives weighted prompts from a mood).
- **Value Objects** — `Mood`, `MusicPrompt` (immutable, equality by value).
- **Domain Services** — `MoodInterpreter` (maps free-text input onto the
  canonical mood vocabulary).
- **Repository interfaces** — `MusicSessionRepository` (the *what*, not the *how*).
- **Errors** — `DomainError` and friends.

#### `src/application/` — use cases & contracts
- **Use Cases** (one class, one `execute(dto)` method):
  - `StartMusicSessionUseCase`
  - `SteerMoodUseCase`
  - `ControlPlaybackUseCase`
- **DTOs** — input/output contracts (`MusicSessionDto`, …). Use cases never
  return raw domain entities.
- **Ports** — abstractions the application depends on but doesn't implement:
  `MusicGenerationPort`, `AudioOutputPort`, `IdGenerator`.
- **`AppUseCases`** — the public use-case surface consumed by the UI.

#### `src/infrastructure/` — the outside world (all I/O)
- `genai/LyriaRealtimeMusicGenerator` — implements `MusicGenerationPort` with
  the `@google/genai` SDK (Lyria RealTime). SDK errors are re-thrown as
  `DomainError`.
- `audio/WebAudioToneOutput` — implements `AudioOutputPort` using the Web Audio
  API, the AudioWorklet, and Tone.js.
- `persistence/InMemoryMusicSessionRepository` — implements
  `MusicSessionRepository`.
- `id/CryptoIdGenerator` — implements `IdGenerator`.
- `config/env.ts` — the **only** place environment variables are read.
- `composition/container.ts` — the composition root that wires concretes to
  use cases.

#### `src/interfaces/` — entry points & presentation
- `App.tsx` + components/hooks — thin React UI.
- `controllers/MusicSessionController` — validates input → calls a use case →
  returns a DTO / normalized error. No business logic.
- `context/UseCasesContext` — receives injected use cases via React context.

#### `src/bootstrap.tsx` — composition entry point
The single seam outside the layer folders where infrastructure is constructed
(`createContainer()`) and **injected** into the interfaces layer. This keeps the
`interfaces` layer free of any direct `infrastructure` import.

### How the dependency rule is enforced
ESLint `no-restricted-imports` rules in `.eslintrc.cjs` fail the build if a layer
imports from a forbidden layer (e.g. `domain` importing `application`, or
`interfaces` importing `infrastructure`). The machine-readable contract lives in
`architecture.json`, and each layer documents its own rules in a local
`CLAUDE.md`.

---

## Audio pipeline at a glance

```
Lyria RealTime (base64 PCM)
        │  onAudioChunk
        ▼
StartMusicSessionUseCase ──► AudioOutputPort.enqueue
        │
        ▼
WebAudioToneOutput
   decode PCM16 → Float32 (per channel)
        │  postMessage (transfer)
        ▼
AudioWorklet: pcm-player-processor  (gapless ring buffer)
        │
        ▼
Tone.Gain → Tone.Limiter → destination 🔊
```

The AudioWorklet processor lives in `public/worklets/pcm-player-processor.js`
so the browser can load it as a separate module on the audio thread.

---

## Notes & caveats

- Lyria RealTime is an experimental model; the model id is configurable via
  `VITE_LYRIA_MODEL`. Adjust `LyriaRealtimeMusicGenerator` if Google changes the
  live-music SDK surface.
- The dev server sets COOP/COEP headers to keep AudioWorklet + cross-origin
  isolation happy. Adjust in `vite.config.ts` if you embed external resources.
- Persistence is in-memory by default — swap `InMemoryMusicSessionRepository`
  for an IndexedDB/backend implementation without touching domain or application
  code.
