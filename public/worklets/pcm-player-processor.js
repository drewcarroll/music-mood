/**
 * AudioWorkletProcessor for gapless playback of streamed PCM audio.
 *
 * It holds a fixed-capacity ring buffer (one Float32Array per channel) and
 * emits samples on the *audio thread*, 128 frames per render quantum,
 * independently of whatever the main thread / UI is doing. Both the producer
 * (`port.onmessage`) and the consumer (`process`) run on the single audio
 * thread inside the AudioWorkletGlobalScope, so the read/write indices need no
 * locks or atomics.
 *
 * Priming (jitter absorption): the processor outputs silence until it has
 * buffered `primeFrames` of audio, then streams continuously. This absorbs
 * network/decode/UI jitter — the most common cause of glitchy playback. On a
 * true underrun it un-primes and re-primes rather than stuttering
 * sample-by-sample. Overflow drops the OLDEST frames so playback latency stays
 * bounded for a live stream.
 *
 * Messages from the main thread:
 *   { type: 'chunk', channels: Float32Array[] }  -> enqueue decoded frames
 *   { type: 'flush' }                            -> drop all buffered audio
 *
 * processorOptions: { channelCount?, capacityFrames?, primeFrames? }
 */

/** Fixed-capacity single-producer/single-consumer ring of planar Float32 channels. */
class RingBuffer {
  constructor(channelCount, capacity) {
    this.channelCount = channelCount;
    this.capacity = capacity;
    this.channels = [];
    for (let c = 0; c < channelCount; c++) {
      this.channels.push(new Float32Array(capacity));
    }
    this.read = 0;
    this.write = 0;
    this.size = 0;
  }

  get available() {
    return this.size;
  }

  /**
   * Append a decoded chunk ([channel][frame]). Returns the number of oldest
   * frames dropped to make room (0 when there was space). A mono source feeding
   * a stereo buffer is duplicated across channels.
   */
  push(chunkChannels) {
    const src0 = chunkChannels[0];
    const incoming = src0 ? src0.length : 0;
    if (incoming === 0) return 0;

    let dropped = 0;
    const overflow = this.size + incoming - this.capacity;
    if (overflow > 0) {
      this.read = (this.read + overflow) % this.capacity;
      this.size -= overflow;
      dropped = overflow;
    }

    let w = this.write;
    const last = chunkChannels.length - 1;
    for (let i = 0; i < incoming; i++) {
      for (let c = 0; c < this.channelCount; c++) {
        const src = chunkChannels[c] || chunkChannels[last];
        this.channels[c][w] = src ? src[i] : 0;
      }
      if (++w === this.capacity) w = 0;
    }
    this.write = w;
    this.size += incoming;
    return dropped;
  }

  /** Pull up to `frames` into the output channel arrays. Returns frames read. */
  pull(outputs, frames) {
    const toRead = Math.min(frames, this.size);
    let r = this.read;
    for (let i = 0; i < toRead; i++) {
      for (let c = 0; c < outputs.length; c++) {
        outputs[c][i] = this.channels[Math.min(c, this.channelCount - 1)][r];
      }
      if (++r === this.capacity) r = 0;
    }
    this.read = r;
    this.size -= toRead;
    return toRead;
  }

  clear() {
    this.read = 0;
    this.write = 0;
    this.size = 0;
  }
}

class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const channelCount = opts.channelCount || 2;
    // `sampleRate` is a global in the AudioWorkletGlobalScope.
    const capacity = opts.capacityFrames || Math.floor(sampleRate * 12);
    this.primeFrames =
      opts.primeFrames != null ? opts.primeFrames : Math.floor(sampleRate * 1.5);

    this.buffer = new RingBuffer(channelCount, capacity);
    this.primed = false;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'chunk') {
        this.buffer.push(msg.channels);
        if (!this.primed && this.buffer.available >= this.primeFrames) {
          this.primed = true;
        }
      } else if (msg.type === 'flush') {
        this.buffer.clear();
        this.primed = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0].length;

    if (!this.primed) {
      // Still (re)buffering: emit silence until we have primeFrames queued.
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    const read = this.buffer.pull(output, frames);

    // Zero-fill any shortfall (underrun within a render quantum).
    if (read < frames) {
      for (let c = 0; c < output.length; c++) {
        for (let i = read; i < frames; i++) output[c][i] = 0;
      }
    }

    if (this.buffer.available === 0) {
      // Drained: re-prime before resuming so we don't stutter sample-by-sample.
      this.primed = false;
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PcmPlayerProcessor);
