import { noteName, type Passage } from './passages.ts';
import type { DisplaySettings } from './settings.ts';

export const SHEET_WIDTH = 288;
export const SHEET_HEIGHT = 144;

type Plot = (x: number, y: number) => void;

const GLYPHS: Record<string, string[]> = {
  A: ['010','101','111','101','101'], B: ['110','101','110','101','110'],
  C: ['011','100','100','100','011'], D: ['110','101','101','101','110'],
  E: ['111','100','110','100','111'], F: ['111','100','110','100','100'],
  G: ['011','100','101','101','011'], '#': ['101','111','101','111','101'],
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
  '2': ['110','001','010','100','111'], '3': ['110','001','010','001','110'],
  '4': ['101','101','111','001','001'], '5': ['111','100','110','001','110'],
  '6': ['011','100','110','101','010'], '7': ['111','001','010','010','010'],
  '8': ['010','101','010','101','010'], '9': ['010','101','011','001','110'],
};

function line(plot: Plot, x0: number, y0: number, x1: number, y1: number): void {
  let x = Math.round(x0), y = Math.round(y0);
  const dx = Math.abs(Math.round(x1) - x), dy = -Math.abs(Math.round(y1) - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    plot(x, y);
    if (x === Math.round(x1) && y === Math.round(y1)) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

function glyph(plot: Plot, value: string, x: number, y: number, scale: number): void {
  let offset = 0;
  for (const char of value) {
    const rows = GLYPHS[char];
    if (rows) rows.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] !== '1') continue;
        for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
          plot(x + offset + column * scale + xx, y + rowIndex * scale + yy);
        }
      }
    });
    offset += 4 * scale;
  }
}

function ellipse(plot: Plot, cx: number, cy: number, rx: number, ry: number, hollow: boolean): void {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const distance = x * x / (rx * rx) + y * y / (ry * ry);
    if (distance <= 1 && (!hollow || distance >= 0.52)) plot(cx + x, cy + y);
  }
}

function yForPitch(midi: number, bottom: number, step: number): number {
  // E4 is the bottom treble staff line. Each diatonic step moves half a staff gap.
  const chromaticLetters = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const octave = Math.floor(midi / 12) - 1;
  const diatonic = octave * 7 + chromaticLetters[midi % 12];
  return Math.round(bottom - (diatonic - (4 * 7 + 2)) * step);
}

/** One grayscale value (0 or 15) per pixel for the SDK's imageData field. */
export function renderSheetImage(passage: Passage, settings: DisplaySettings): Uint8Array {
  const pixels = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT).fill(15);
  const plot: Plot = (x, y) => {
    if (x >= 0 && x < SHEET_WIDTH && y >= 0 && y < SHEET_HEIGHT) pixels[y * SHEET_WIDTH + x] = 0;
  };
  const large = settings.sheetMusicSize === 'large';
  const gap = large ? 14 : 11;
  const bottom = large ? 96 : 91;
  const step = gap / 2;
  const left = 40, right = 282;
  for (let staff = 0; staff < 5; staff++) line(plot, 5, bottom - staff * gap, right, bottom - staff * gap);
  // A fixed treble clef: scroll, stem, and loop stay legible at either size.
  ellipse(plot, 20, bottom - gap * 2, 9, 12, true);
  line(plot, 22, bottom + 8, 18, bottom - gap * 4 - 9);
  ellipse(plot, 18, bottom - gap * 4 - 8, 5, 7, true);
  const endBeat = Math.max(passage.beatsPerBar, ...passage.notes.map(note => note.onsetBeat + note.durationBeats));
  const width = right - left - 10;
  const at = (beat: number): number => Math.round(left + beat / endBeat * width);
  for (let beat = passage.beatsPerBar; beat <= endBeat; beat += passage.beatsPerBar) {
    line(plot, at(beat) - 9, bottom - 4 * gap, at(beat) - 9, bottom);
  }
  const occupied = new Set<number>();
  for (const note of passage.notes) {
    for (let beat = note.onsetBeat; beat < note.onsetBeat + note.durationBeats; beat++) occupied.add(beat);
    const x = at(note.onsetBeat) + 7;
    const y = yForPitch(note.midiPitch, bottom, step);
    const rx = large ? 7 : 6, ry = large ? 5 : 4;
    if (y >= bottom + gap) line(plot, x - 10, bottom + gap, x + 10, bottom + gap);
    ellipse(plot, x, y, rx, ry, note.durationBeats >= 2);
    line(plot, x + rx, y, x + rx, y - (large ? 34 : 29));
    if (settings.showNoteNames) glyph(plot, noteName(note.midiPitch), x - 7, 116, large ? 2 : 1);
  }
  // Each unoccupied beat is an explicit quarter rest in the authored phrase.
  for (let beat = 0; beat < endBeat; beat++) {
    if (occupied.has(beat)) continue;
    const x = at(beat) + 7, y = bottom - 2 * gap;
    line(plot, x - 3, y - 10, x + 3, y - 3);
    line(plot, x + 3, y - 3, x - 3, y + 4);
    line(plot, x - 3, y + 4, x + 3, y + 10);
  }
  return pixels;
}
