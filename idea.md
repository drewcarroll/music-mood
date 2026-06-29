# Music Mood — Long-Term Vision

## The one-liner

A web app where five emoji, each with a slider, set how much of each emotion is
present in a single, continuously playing instrumental stream. Move a slider and
the music morphs toward that mood in real time — without ever stopping.

## What makes it special

The magic is in two places, and the build exists to protect both:

1. **The in-between.** Happy plus a touch of sad reads as bittersweet. The app
   isn't a mood switcher; it's a mood _blender_. Five emotions are always in the
   mix, and the sliders set their relative loudness.
2. **The smoothness.** Slider moves should feel like easing, not snapping. The
   transition itself is the product.

## Why it's feasible now

Google DeepMind's **Lyria RealTime** model (via the Gemini API) is purpose-built
for exactly this interaction. It holds an open WebSocket and produces a continuous
stream of instrumental audio, generating ~2-second chunks on the fly, each shaped
by the weighted text prompts you currently have set. You steer it live by
adjusting prompt weights.

No clip-based model (Suno, Udio, ElevenLabs Music, Lyria 3 Clip) can do this —
each generates a finished file per request, so none can morph continuously. The
streaming-and-steering design is the entire reason this concept works.

## Core mechanic

Each emoji is a **persistent weighted prompt** described in model-friendly keywords:

- 😊 happy → uplifting, bright, major key, warm acoustic guitar, lively tempo
- 😢 sad → melancholy, sparse, minor key, slow, soft piano
- 😠 angry → aggressive, distorted, driving drums, dark
- 😌 calm → ambient, gentle, airy synth pads, soft
- 😎 hype → energetic, punchy beat, electronic, confident

Each slider sets a **target weight**. An easing render loop (~100-150 ms tick)
nudges each prompt's _current_ weight toward its target and sends the entire prompt
set every tick via `setWeightedPrompts`. Because all prompts are always sent
together, the model blends them naturally and slider moves arrive as gradual
changes. That easing loop _is_ the continuity solution.

## Stack

- React + TypeScript — five emoji controls, sliders, live visualizer.
- `@google/genai` SDK — Lyria RealTime session.
- Web Audio API (`AudioContext` + `AudioWorklet`) — gapless streaming playback.
- Tone.js — offline fallback engine.

## Key technical facts

- Model: `models/lyria-realtime-exp`, requires `v1alpha` API version.
- Output: raw 16-bit PCM, 48 kHz, stereo. Create `AudioContext` at 48000 Hz.
  (If pitch sounds wrong, suspect a sample-rate mismatch first.)
- Instrumental only (vocalization mode produces oohs/aahs, not lyrics).
- Currently free and experimental — no SLA, so a fallback is mandatory.
- ~10-minute session cap → reconnect transparently before it.
- 5-10s settling period on stream start / context reset.
- ~2s latency between a control change and hearing it — a feature here, it makes
  morphs feel like easing.

## Gotchas worth remembering

- A prompt weight of exactly 0 is not allowed. Drop the prompt or floor it at a
  tiny epsilon when a slider is near zero.
- Don't normalize weights yourself — relative magnitudes matter. A slider range
  of ~0 to 2 per emoji works well.
- Keep `bpm` and `scale` fixed during a performance — changing either forces
  `reset_context()` and an audible seam. Morph via prompt weights plus `density`
  and `brightness`.
- Run `guidance` low (~2-3) so blends are gentle rather than abrupt.
- Buffer 2-3 chunks before playing to absorb jitter — the most common cause of
  glitchy playback.
- Do audio processing in an `AudioWorklet`, not the main thread, so UI activity
  doesn't cause stutter.

## Build sequence

1. Single hardcoded prompt streaming and playing gapless — proves the riskiest
   piece (audio pipeline).
2. Five emoji + sliders wired to static weights (no easing) — confirm blends
   sound reasonable.
3. Easing loop for smooth morphs — the moment the demo becomes the demo.
4. Tune descriptors, `guidance`, `density`, `brightness` until in-between moods
   sound intentional.
5. Tone.js fallback + visualizer.

## Demo-proofing principles

- **Fallback engine.** Tone.js layer with the same emoji-to-parameter mapping,
  takes over if the WebSocket drops. Its job is reliability, not parity — a
  working instrument beats silence.
- **Settle before presenting.** Let the stream stabilize ~10s before the first
  slider move.
- **Session cap.** Reconnect transparently before the ~10-min limit.
- **Auth.** Client-side key is fine for local dev. For anything semi-public, use
  Gemini ephemeral auth tokens (`authTokens.create`) or proxy through a small
  backend so the real key never ships to the browser.

## Open questions / risks

- Do the five emotions produce _distinct enough_ sounds to read clearly in a room?
  Test descriptors early — vague prompts give generic results.
- Regional/quota availability of the experimental model on demo day — confirm the
  key works from the demo machine ahead of time.
- How polished must the fallback sound if it ever takes over? Decide the bar.

## References

- Lyria RealTime API docs: https://ai.google.dev/gemini-api/docs/realtime-music-generation
- Live Music WebSockets reference: https://ai.google.dev/api/live_music
- Developer walkthrough (incl. cross-fade pattern): https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h
- Lyria RealTime overview (DeepMind): https://deepmind.google/models/lyria/lyria-realtime/
