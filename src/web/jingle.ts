// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// The disco jingle the Jukebox theme plays on download, as plain data:
// what plays when. sound.ts turns it into audio with Web Audio.

/** One note of the jingle, in seconds from its start. */
export interface Note {
  time: number;
  duration: number;
  instrument: "kick" | "clap" | "hat" | "crash" | "bass" | "stab";
  /** Pitches in hertz; empty for the drums. */
  frequencies: number[];
}

/** One beat at 128 BPM, the classic disco tempo, in seconds. */
export const BEAT = 60 / 128;

/** The frequency of MIDI note `note`, in equal temperament with A4 = 440 Hz. */
export function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * One bar of disco at 128 BPM, shaped to end on a punch: a groove for three
 * beats (four-on-the-floor kick, claps on the backbeat, open hi-hats on the
 * off-beats, an octave bass line), two short G major stabs, then everything
 * landing together on the last beat: a long A major chord over a low A,
 * with kick, clap and a crash ringing out. Nothing plays after it.
 */
export function discoJingle(): Note[] {
  const notes: Note[] = [];
  const add = (beat: number, duration: number, instrument: Note["instrument"], midi: number[] = []) =>
    notes.push({ time: beat * BEAT, duration, instrument, frequencies: midi.map(midiToFrequency) });

  const final = 3;
  for (let beat = 0; beat <= final; beat++) add(beat, 0.3, "kick");
  for (const beat of [1, final]) add(beat, 0.2, "clap");
  for (const beat of [0.5, 1.5, 2.5]) add(beat, 0.12, "hat");

  // E2 E3 E2 E3 G2 G3 on eighth notes, then a long low A1 under the final chord.
  [40, 52, 40, 52, 43, 55].forEach((midi, eighth) => add(eighth / 2, 0.2, "bass", [midi]));
  add(final, 0.9, "bass", [33]);

  // "Da-da": two short G major stabs (G3 B3 D4)...
  add(2, 0.14, "stab", [55, 59, 62]);
  add(2.5, 0.14, "stab", [55, 59, 62]);
  // ..."DAAA": A major (A3 C#4 E4 A4), G to A being the triumphant move.
  add(final, 1, "stab", [57, 61, 64, 69]);
  add(final, 1.1, "crash");

  return notes.sort((a, b) => a.time - b.time);
}
