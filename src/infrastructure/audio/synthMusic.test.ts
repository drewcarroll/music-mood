import { describe, expect, it } from 'vitest';
import {
  buildChord,
  buildScaleNotes,
  noteName,
  parseScaleRoots,
  selectKey,
  tokenToPitchClass,
} from './synthMusic';

describe('tokenToPitchClass', () => {
  it('maps naturals, flats and sharps to pitch classes', () => {
    expect(tokenToPitchClass('C')).toBe(0);
    expect(tokenToPitchClass('A')).toBe(9);
    expect(tokenToPitchClass('E_FLAT')).toBe(3); // Eb == D#
    expect(tokenToPitchClass('A_FLAT')).toBe(8); // Ab == G#
    expect(tokenToPitchClass('F_SHARP')).toBe(6);
  });

  it('falls back to C for nonsense', () => {
    expect(tokenToPitchClass('ZZ')).toBe(0);
  });
});

describe('parseScaleRoots', () => {
  it('splits an SDK Scale enum name into its relative major and minor tonics', () => {
    expect(parseScaleRoots('G_MAJOR_E_MINOR')).toEqual({ major: 7, minor: 4 });
    expect(parseScaleRoots('E_FLAT_MAJOR_C_MINOR')).toEqual({ major: 3, minor: 0 });
    expect(parseScaleRoots('A_MAJOR_G_FLAT_MINOR')).toEqual({ major: 9, minor: 6 });
  });

  it('falls back to C major / A minor for an unrecognized string', () => {
    expect(parseScaleRoots('not-a-scale')).toEqual({ major: 0, minor: 9 });
  });
});

describe('selectKey', () => {
  it('reads a bright blend as the relative major', () => {
    expect(selectKey('G_MAJOR_E_MINOR', 0.8)).toEqual({ rootPc: 7, mode: 'major' });
  });

  it('reads a dark blend as the relative minor of the same scale', () => {
    expect(selectKey('G_MAJOR_E_MINOR', 0.2)).toEqual({ rootPc: 4, mode: 'minor' });
  });

  it('treats exactly 0.5 as major', () => {
    expect(selectKey('C_MAJOR_A_MINOR', 0.5).mode).toBe('major');
  });
});

describe('noteName', () => {
  it('renders pitch class + octave with octave carry', () => {
    expect(noteName(0, 0, 4)).toBe('C4');
    expect(noteName(0, 7, 4)).toBe('G4'); // perfect fifth up
    expect(noteName(9, 4, 3)).toBe('C#4'); // A3 + major third carries into octave 4
  });
});

describe('buildChord', () => {
  it('builds a major tonic triad (root, major third, fifth)', () => {
    expect(buildChord(0, 'major', 3)).toEqual(['C3', 'E3', 'G3']);
  });

  it('builds a minor tonic triad (root, minor third, fifth)', () => {
    expect(buildChord(9, 'minor', 3)).toEqual(['A3', 'C4', 'E4']);
  });
});

describe('buildScaleNotes', () => {
  it('lays out one ascending octave of the major scale', () => {
    expect(buildScaleNotes(0, 'major', 4)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
  });

  it('lays out one ascending octave of the natural-minor scale', () => {
    expect(buildScaleNotes(9, 'minor', 3)).toEqual(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4']);
  });
});
