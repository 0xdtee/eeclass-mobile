/**
 * Subtitle export (SRT / WebVTT) built from a session's transcript lines.
 * Cue times come from each line's `start`/`end` (seconds from class start, the same clock the
 * audio player uses), so the file lines up with the class recording. A line's translation, when
 * present, becomes a second subtitle line under the original.
 */
import { saveBlob, safeFileName } from './download';

export type SubtitleFormat = 'srt' | 'vtt';

export interface SubtitleLine {
  start?: number;
  end?: number;
  text: string;
  translation?: string;
}

/** A line with no recorded end is shown this long (and never past the next line's start). */
const DEFAULT_DURATION = 3;

interface Cue { start: number; end: number; text: string }

function toCues(lines: SubtitleLine[]): Cue[] {
  const timed = lines.filter((l) => typeof l.start === 'number' && l.text.trim());
  return timed.map((l, i) => {
    const start = Math.max(0, l.start as number);
    const next = timed[i + 1]?.start;
    const hasEnd = typeof l.end === 'number' && l.end > start;
    let end = hasEnd ? (l.end as number) : start + DEFAULT_DURATION;
    if (!hasEnd && typeof next === 'number' && next > start) end = Math.min(end, next);
    // a blank line inside a cue would end it early in both formats
    const text = [l.text.trim(), l.translation?.trim()].filter(Boolean).join('\n').replace(/\n{2,}/g, '\n');
    return { start, end, text };
  });
}

function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** True when at least one line carries a timestamp, i.e. a subtitle file would not be empty. */
export function hasSubtitleTiming(lines: SubtitleLine[]): boolean {
  return lines.some((l) => typeof l.start === 'number' && l.text.trim());
}

export function buildSubtitle(lines: SubtitleLine[], format: SubtitleFormat): string {
  const cues = toCues(lines);
  if (format === 'srt') {
    return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
  }
  // VTT forbids "-->" inside cue text
  const body = cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text.replace(/-->/g, '->')}\n`);
  return ['WEBVTT\n', ...body].join('\n');
}

export function downloadSubtitle(lines: SubtitleLine[], format: SubtitleFormat, title: string): Promise<void> {
  // SRT gets a BOM so players on Windows don't misread the Chinese as a legacy codepage
  const text = (format === 'srt' ? '﻿' : '') + buildSubtitle(lines, format);
  const blob = new Blob([text], { type: format === 'srt' ? 'application/x-subrip;charset=utf-8' : 'text/vtt;charset=utf-8' });
  return saveBlob(blob, `${safeFileName(title, '课堂转写')}.${format}`);
}
