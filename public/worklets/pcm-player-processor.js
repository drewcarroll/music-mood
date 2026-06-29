/**
 * AudioWorkletProcessor for gapless playback of streamed PCM audio.
 *
 * It maintains a ring of queued Float32 frames (one Float32Array per channel)
 * and feeds them to the audio graph sample-accurately on the audio thread,
 * which avoids the glitches you get from scheduling many short BufferSources.
 *
 * Messages from the main thread:
 *   { type: 'chunk', channels: Float32Array[] }  -> enqueue decoded frames
 *   { type: 'flush' }                            -> drop all buffered audio
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array[][]} queue of [chunk][channel] */
    this.queue = [];
    this.readChunk = 0;
    this.readOffset = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'chunk') {
        this.queue.push(msg.channels);
      } else if (msg.type === 'flush') {
        this.queue = [];
        this.readChunk = 0;
        this.readOffset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0].length;
    const numChannels = output.length;

    for (let i = 0; i < frames; i++) {
      if (this.readChunk >= this.queue.length) {
        // Underflow: output silence.
        for (let c = 0; c < numChannels; c++) output[c][i] = 0;
        continue;
      }

      const chunk = this.queue[this.readChunk];
      for (let c = 0; c < numChannels; c++) {
        const channelData = chunk[Math.min(c, chunk.length - 1)];
        output[c][i] = channelData ? channelData[this.readOffset] : 0;
      }

      this.readOffset++;
      if (this.readOffset >= chunk[0].length) {
        this.readOffset = 0;
        this.readChunk++;
      }
    }

    // Periodically compact the queue to release consumed chunks.
    if (this.readChunk > 16) {
      this.queue = this.queue.slice(this.readChunk);
      this.readChunk = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PcmPlayerProcessor);
