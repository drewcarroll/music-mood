/**
 * AudioWorkletProcessor for gapless playback of streamed PCM audio.
 *
 * It owns a fixed-capacity ring buffer (one Float32Array per channel) that is
 * fed by the main thread and drained, sample-accurately, on the audio render
 * thread. Because draining happens entirely inside `process()` — off the main
 * thread — playback never stutters when the UI is busy: main-thread jank can
 * only delay *refilling* the ring, and the buffer's headroom absorbs that.
 *
 * Messages from the main thread:
 *   { type: 'chunk', channels: Float32Array[] }  -> write decoded frames
 *   { type: 'flush' }                            -> drop all buffered audio
 *
 * processorOptions:
 *   channelCount?: number   number of channels to buffer (default 2)
 *   ringSeconds?:  number   ring capacity in seconds of audio (default 8)
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.channelCount = Math.max(1, opts.channelCount || 2);
    const ringSeconds = opts.ringSeconds || 8;

    // Capacity in frames per channel. `sampleRate` is a global in the
    // AudioWorkletGlobalScope and equals the AudioContext's sample rate.
    this.capacity = Math.max(1, Math.ceil(sampleRate * ringSeconds));
    this.ring = new Array(this.channelCount);
    for (let c = 0; c < this.channelCount; c++) {
      this.ring[c] = new Float32Array(this.capacity);
    }

    this.writeIndex = 0; // next frame to write
    this.readIndex = 0; // next frame to read
    this.available = 0; // frames currently buffered

    // Diagnostics (frames lost to overflow / silence emitted on underflow).
    this.droppedFrames = 0;
    this.underflowFrames = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'chunk') {
        this.write(msg.channels);
      } else if (msg.type === 'flush') {
        this.writeIndex = 0;
        this.readIndex = 0;
        this.available = 0;
      }
    };
  }

  /**
   * Write decoded frames into the ring. Runs on the audio thread (the worklet
   * message handler), so it never contends with the main thread for the buffer.
   * On overflow the oldest frames are dropped to keep playback latency bounded.
   * @param {Float32Array[]} channels one Float32Array per source channel
   */
  write(channels) {
    if (!channels || channels.length === 0) return;
    let incoming = channels[0] ? channels[0].length : 0;
    if (incoming === 0) return;

    // A single chunk larger than the whole ring: keep only its newest tail.
    let srcStart = 0;
    if (incoming > this.capacity) {
      srcStart = incoming - this.capacity;
      incoming = this.capacity;
      this.droppedFrames += srcStart;
    }

    // Make room by dropping the oldest buffered frames if needed.
    const overflow = this.available + incoming - this.capacity;
    if (overflow > 0) {
      this.readIndex = (this.readIndex + overflow) % this.capacity;
      this.available -= overflow;
      this.droppedFrames += overflow;
    }

    // Two contiguous segments: writeIndex..end, then wrap to 0.
    const firstLen = Math.min(incoming, this.capacity - this.writeIndex);
    const secondLen = incoming - firstLen;

    for (let c = 0; c < this.channelCount; c++) {
      // Mono sources fan out to every channel; otherwise map 1:1.
      const src = channels[Math.min(c, channels.length - 1)];
      if (!src) continue;
      this.ring[c].set(src.subarray(srcStart, srcStart + firstLen), this.writeIndex);
      if (secondLen > 0) {
        this.ring[c].set(src.subarray(srcStart + firstLen, srcStart + incoming), 0);
      }
    }

    this.writeIndex = (this.writeIndex + incoming) % this.capacity;
    this.available += incoming;
  }

  /**
   * Pull one render quantum out of the ring on the audio thread. Underflowed
   * tail samples are filled with silence rather than repeating stale audio.
   */
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const frames = output[0].length;
    const numChannels = output.length;
    const toRead = Math.min(frames, this.available);

    const firstLen = Math.min(toRead, this.capacity - this.readIndex);
    const secondLen = toRead - firstLen;

    for (let c = 0; c < numChannels; c++) {
      const ring = this.ring[Math.min(c, this.channelCount - 1)];
      const out = output[c];
      out.set(ring.subarray(this.readIndex, this.readIndex + firstLen), 0);
      if (secondLen > 0) {
        out.set(ring.subarray(0, secondLen), firstLen);
      }
      for (let i = toRead; i < frames; i++) {
        out[i] = 0;
      }
    }

    if (toRead > 0) {
      this.readIndex = (this.readIndex + toRead) % this.capacity;
      this.available -= toRead;
    }
    if (toRead < frames) {
      this.underflowFrames += frames - toRead;
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PcmPlayerProcessor);
