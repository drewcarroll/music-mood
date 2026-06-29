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

**Pre-roll buffering:** the worklet buffers a configurable number of chunks
(`prerollChunks`, default **3**, set via `WebAudioToneOutput`) before emitting
the first sample, so network jitter and generation-timing variance are absorbed
up front. If the ring buffer ever drains completely (an underrun), the processor
re-primes — re-buffering `prerollChunks` before resuming — instead of dribbling
out fragments separated by silence. A `flush` (e.g. on mood steer) also re-primes
so the next mood starts cleanly.

### Audio format & sample rate

Lyria RealTime streams **48 kHz, stereo (2-channel), 16-bit signed little-endian
PCM**. This is treated as canonical, but it is also **verified against the actual
chunk metadata** rather than assumed:

- `LyriaRealtimeMusicGenerator` parses each chunk's `mimeType`
  (e.g. `audio/pcm;rate=48000`) via `parsePcmMimeType`, logs a one-time
  confirmation of the resolved `rate / channels / bit-depth`, and **warns** if it
  deviates from 48 kHz / stereo / 16-bit. The parsed rate and channel count flow
  through to the decoder and de-interleaver.
- `WebAudioToneOutput` pins the `AudioContext` to 48 kHz, then reads back
  `context.sampleRate` (the rate the browser actually granted) and warns if the
  device forced a different rate.

**Why this matters:** the AudioWorklet emits samples at the AudioContext's rate.
Playback pitch is correct **only when the context rate equals the stream rate** —
a 48 kHz stream played through a 44.1 kHz context plays ~8.8 % slow (and the
reverse sounds chipmunk-fast). A wrong-sounding pitch is therefore the first
symptom of a sample-rate mismatch.

**Mismatch fallback path** (if Google ever changes the sample rate): `enqueue`
compares the stream's reported rate to the context rate and warns once with the
exact pitch-ratio error. To correct it, recreate the `AudioContext` at the
stream's reported rate (the browser resamples to the hardware rate), or resample
the decoded chunks to the context rate before enqueuing. Bit depths other than
16-bit would also need a decoder update — `decodePcm16` assumes 16-bit.

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
