/**
 * Pure music-theory helpers for the local fallback synth.
 *
 * Kept free of Tone.js (and any I/O) so the mapping from an emoji-blend's
 * key/mode onto concrete note names is unit-testable on its own. The synth feeds
 * the note-name strings this module produces straight into Tone.js voices.
 *
 * The note names use scientific pitch notation with SHARPS only (e.g. "C4",
 * "G#3") — the form Tone.js parses most reliably.
 */

/** The twelve pitch classes, sharps only, indexed 0..11 from C. */
export const PITCH_CLASSES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** Semitone offsets of the major scale degrees within an octave. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
/** Semitone offsets of the natural-minor scale degrees within an octave. */
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

export type Mode = 'major' | 'minor';

/** Map a flat spelling onto its enharmonic sharp so Tone.js parses it cleanly. */
const FLAT_TO_PC: Record<string, number> = {
  CB: 11,
  DB: 1,
  EB: 3,
  FB: 4,
  GB: 6,
  AB: 8,
  BB: 10,
};
const NATURAL_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Convert a Scale-enum pitch token (e.g. "C", "A_FLAT", "F_SHARP") to its pitch
 * class 0..11. Unknown tokens fall back to C (0) so the synth never throws.
 */
export function tokenToPitchClass(token: string): number {
  const t = token.toUpperCase();
  if (t.endsWith('_FLAT')) return FLAT_TO_PC[t[0] + 'B'] ?? 0;
  if (t.endsWith('_SHARP')) return (NATURAL_TO_PC[t[0]] + 1 + 12) % 12;
  return NATURAL_TO_PC[t] ?? 0;
}

/**
 * Split an SDK Scale enum name ("<MAJOR_ROOT>_MAJOR_<MINOR_ROOT>_MINOR") into
 * the pitch classes of its relative major and minor tonics. Falls back to
 * C major / A minor for anything unrecognized.
 */
export function parseScaleRoots(scale: string): { major: number; minor: number } {
  const [majorPart, rest] = scale.split('_MAJOR_');
  if (rest === undefined) return { major: 0, minor: 9 };
  const minorPart = rest.replace(/_MINOR.*$/, '');
  return { major: tokenToPitchClass(majorPart), minor: tokenToPitchClass(minorPart) };
}

/**
 * Pick the tonic + mode the synth should play in. Mode follows brightness — a
 * bright blend reads as major, a dark one as minor — and the tonic is the
 * matching relative root of the chosen scale, so e.g. a dark "G major / E minor"
 * blend resolves to E minor rather than G major.
 */
export function selectKey(scale: string, brightness: number): { rootPc: number; mode: Mode } {
  const roots = parseScaleRoots(scale);
  const mode: Mode = brightness >= 0.5 ? 'major' : 'minor';
  return { rootPc: mode === 'major' ? roots.major : roots.minor, mode };
}

/** Render a pitch class + octave (with carry) into a Tone.js note name. */
export function noteName(rootPc: number, semitoneOffset: number, octave: number): string {
  const total = rootPc + semitoneOffset;
  const pc = ((total % 12) + 12) % 12;
  const octaveShift = Math.floor(total / 12);
  return `${PITCH_CLASSES[pc]}${octave + octaveShift}`;
}

/**
 * The tonic triad for a mode: root, third (major=4 / minor=3 semitones), fifth.
 * Used by the sustained pad so its chord quality tracks the mood.
 */
export function buildChord(rootPc: number, mode: Mode, octave: number): string[] {
  const third = mode === 'major' ? 4 : 3;
  return [
    noteName(rootPc, 0, octave),
    noteName(rootPc, third, octave),
    noteName(rootPc, 7, octave),
  ];
}

/**
 * One ascending octave of the mode's scale from the tonic, used as the arp's
 * note pool. `octave` sets the starting register.
 */
export function buildScaleNotes(rootPc: number, mode: Mode, octave: number): string[] {
  const degrees = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return degrees.map((semis) => noteName(rootPc, semis, octave));
}
