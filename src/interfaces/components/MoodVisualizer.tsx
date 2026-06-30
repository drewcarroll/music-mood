import React, { useEffect, useRef } from 'react';
import {
  EMOTION_DESCRIPTORS,
  EMOTION_NAMES,
  MAX_EMOTION_WEIGHT,
  type EmotionName,
} from '@domain/value-objects/EmotionDescriptor';
import type { LiveWeight } from '@interfaces/hooks/useMusicMood';

interface MoodVisualizerProps {
  /** Stable accessor onto the live eased mix; polled once per animation frame. */
  getWeights: () => LiveWeight[];
  /** Whether a stream is live — drives the idle hint overlay. */
  active?: boolean;
}

type Rgb = readonly [number, number, number];

/**
 * A characteristic color per emotion. Pure presentation, so the palette lives
 * here rather than in the domain — the canonical emotion list and emoji still
 * come from the domain value object. Hues are spread around the wheel so blends
 * read as distinct in-between colors.
 */
const EMOTION_RGB: Record<EmotionName, Rgb> = {
  happy: [255, 211, 77], // gold
  sad: [77, 140, 255], // blue
  angry: [255, 77, 77], // red
  calm: [41, 211, 196], // teal
  hype: [255, 122, 26], // orange
};

/** Per-frame smoothing of the displayed weights toward the source (≈60fps). */
const VIS_LERP = 0.14;
/** First vertex points straight up; the rest space evenly clockwise. */
const START_ANGLE = -Math.PI / 2;

/**
 * Live mood-mix visualizer.
 *
 * Reads the eased `current` weights every animation frame and renders them as a
 * field of additively-blended color glows, a morphing weight polygon, and a
 * central swatch tinted with the weight-blended color. The additive glows and
 * the blended center make the "in-between" mood literally visible: two active
 * emotions blend their colors in the middle rather than sitting side by side.
 *
 * The weights step every ~120ms (the easing tick); the canvas lerps toward them
 * each frame, so the motion stays smooth between steps and as sliders move.
 */
export function MoodVisualizer({ getWeights, active = false }: MoodVisualizerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Displayed (smoothed) weight per emotion, in EMOTION_NAMES order.
  const displayedRef = useRef<number[]>(EMOTION_NAMES.map(() => 0));

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = container.clientWidth;
      cssH = container.clientHeight;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const displayed = displayedRef.current;
    let raf = 0;
    const frame = (): void => {
      const src = getWeights();
      for (let i = 0; i < EMOTION_NAMES.length; i++) {
        const target = src.find((w) => w.name === EMOTION_NAMES[i])?.current ?? 0;
        displayed[i] += (target - displayed[i]) * VIS_LERP;
      }
      render(ctx, displayed, cssW, cssH, dpr);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [getWeights]);

  return (
    <section className="mood-visualizer" ref={containerRef} aria-label="Live mood mix visualizer">
      <canvas ref={canvasRef} aria-hidden="true" />
      {!active && <p className="visualizer-hint">Your mood mix will bloom here once a stream is live.</p>}
    </section>
  );
}

/** Render one frame of the visualizer into the 2D context. */
function render(
  ctx: CanvasRenderingContext2D,
  weights: readonly number[],
  cssW: number,
  cssH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (cssW === 0 || cssH === 0) return;

  const cx = cssW / 2;
  const cy = cssH / 2;
  const radius = Math.min(cssW, cssH) / 2 - 28;
  const n = EMOTION_NAMES.length;
  const axis = (i: number): number => START_ANGLE + (i / n) * Math.PI * 2;
  const norm = (w: number): number => Math.max(0, Math.min(1, w / MAX_EMOTION_WEIGHT));

  // Faint guide ring so the field reads as a stage even when idle.
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Additive color glows — overlapping glows sum to the in-between color.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const w = norm(weights[i]);
    if (w <= 0.002) continue;
    const a = axis(i);
    // Pull the glow in from the rim toward center so neighbours overlap.
    const dist = radius * 0.52;
    const gx = cx + Math.cos(a) * dist;
    const gy = cy + Math.sin(a) * dist;
    const r = radius * (0.42 + 0.55 * w);
    const [cr, cg, cb] = EMOTION_RGB[EMOTION_NAMES[i]];
    const alpha = 0.12 + 0.6 * w;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Weight polygon: each vertex distance tracks that emotion's weight, so the
  // shape morphs as the mix changes.
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = axis(i);
    const r = radius * (0.16 + 0.84 * norm(weights[i]));
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Central swatch tinted with the weight-blended color: the literal in-between mood.
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total > 0.01) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.max(0, weights[i]);
      const [cr, cg, cb] = EMOTION_RGB[EMOTION_NAMES[i]];
      r += cr * w;
      g += cg * w;
      b += cb * w;
    }
    r = Math.round(r / total);
    g = Math.round(g / total);
    b = Math.round(b / total);
    const presence = Math.min(1, total / (MAX_EMOTION_WEIGHT * 1.5));
    const swatchR = radius * (0.12 + 0.16 * presence);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, swatchR);
    grad.addColorStop(0, `rgba(${r},${g},${b},${0.85 * presence + 0.15})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, swatchR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Emoji markers around the rim, brightening with their weight.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const w = norm(weights[i]);
    const a = axis(i);
    const ex = cx + Math.cos(a) * (radius + 16);
    const ey = cy + Math.sin(a) * (radius + 16);
    ctx.globalAlpha = 0.35 + 0.65 * w;
    ctx.font = `${Math.round(20 + 12 * w)}px system-ui, sans-serif`;
    ctx.fillText(EMOTION_DESCRIPTORS[EMOTION_NAMES[i]].emoji, ex, ey);
  }
  ctx.globalAlpha = 1;
}
