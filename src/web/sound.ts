// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Audio for the page's themes, synthesized with Web Audio so nothing is
// downloaded: the Jukebox jingle (data below) and the Windoze error beep.

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
export function midiToFrequency (note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * One bar of disco at 128 BPM, shaped to end on a punch: a groove for three
 * beats (four-on-the-floor kick, claps on the backbeat, open hi-hats on the
 * off-beats, an octave bass line), two short G major stabs, then everything
 * landing together on the last beat: a long A major chord over a low A,
 * with kick, clap and a crash ringing out. Nothing plays after it.
 */
export function discoJingle (): Note[] {
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

/** Overall loudness, from 0 to 1: noticeable, not startling. */
const VOLUME = 0.25;

export function playDiscoJingle (context: AudioContext): void {
  const master = context.createGain();
  master.gain.value = VOLUME;
  master.connect(context.destination);

  const noise = whiteNoise(context);
  const start = context.currentTime + 0.05;
  let end = start;
  for (const note of discoJingle()) {
    const time = start + note.time;
    play(context, master, noise, note, time);
    end = Math.max(end, time + note.duration);
  }
  setTimeout(() => void context.close(), (end - context.currentTime + 0.5) * 1000);
}

export function playErrorBeep (context: AudioContext): void {
  const master = context.createGain();
  master.gain.value = VOLUME;
  master.connect(context.destination);

  const harmonics = [1, 0.28, 0.21, 0.03, 0.07, 0.07, 0.15, 0.03];
  const wave = context.createPeriodicWave(
    Float32Array.from([0, ...harmonics]),
    new Float32Array(1 + harmonics.length),
    { disableNormalization: true },
  );

  const start = context.currentTime + 0.02;
  const duration = 1.1;
  const oscillator = context.createOscillator();
  oscillator.setPeriodicWave(wave);
  oscillator.frequency.value = 110;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.5, start + 0.05); // fast attack
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration); // long decay
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function play (
  context: AudioContext,
  output: AudioNode,
  noise: AudioBuffer,
  note: Note,
  time: number,
): void {
  switch (note.instrument) {
    case "kick": {
      // A sine wave dropping quickly in pitch: the "boom".
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(150, time);
      oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      oscillator.connect(envelope(context, output, time, note.duration, 1));
      oscillator.start(time);
      oscillator.stop(time + note.duration);
      break;
    }
    case "hat":
      // High-passed white noise: the "tss".
      playNoise(context, noise, "highpass", 7000, time, note.duration,
        envelope(context, output, time, note.duration, 0.35));
      break;
    case "crash":
      // Bright noise with a long fade: the cymbal ringing out the final hit.
      playNoise(context, noise, "highpass", 5000, time, note.duration,
        envelope(context, output, time, note.duration, 0.3));
      break;
    case "clap": {
      // Band-passed noise in three quick bursts then a short tail, like several
      // hands not quite together.
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, time);
      for (const offset of [0, 0.012, 0.024]) {
        gain.gain.setValueAtTime(0.9, time + offset);
        gain.gain.exponentialRampToValueAtTime(0.2, time + offset + 0.011);
      }
      gain.gain.exponentialRampToValueAtTime(0.001, time + note.duration);
      gain.connect(output);
      playNoise(context, noise, "bandpass", 1500, time, note.duration, gain);
      break;
    }
    case "bass":
    case "stab": {
      // Sawtooth waves through a low-pass filter: a round bass, a bright chord.
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = note.instrument === "bass" ? 900 : 2500;
      filter.Q.value = note.instrument === "bass" ? 4 : 1;
      const peak = note.instrument === "bass" ? 0.6 : 0.12;
      filter.connect(envelope(context, output, time, note.duration, peak));
      // Chords get two slightly detuned oscillators per note: a fatter,
      // brass-and-strings sound. The bass stays a single clean one.
      const detunes = note.instrument === "stab" ? [-7, 7] : [0];
      for (const frequency of note.frequencies) {
        for (const detune of detunes) {
          const oscillator = context.createOscillator();
          oscillator.type = "sawtooth";
          oscillator.frequency.value = frequency;
          oscillator.detune.value = detune;
          oscillator.connect(filter);
          oscillator.start(time);
          oscillator.stop(time + note.duration);
        }
      }
      break;
    }
  }
}

/**
 * A gain node shaping a note: a 5 ms rise to `peak`, then a fade to silence
 * over `duration`, so notes start and stop without clicks.
 */
function envelope (
  context: AudioContext,
  output: AudioNode,
  time: number,
  duration: number,
  peak: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  gain.connect(output);
  return gain;
}

/** Plays `noise` through a `type` filter at `frequency` into `output`. */
function playNoise (
  context: AudioContext,
  noise: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  time: number,
  duration: number,
  output: AudioNode,
): void {
  const source = context.createBufferSource();
  source.buffer = noise;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  source.connect(filter);
  filter.connect(output);
  source.start(time);
  source.stop(time + duration);
}

/** Two seconds of white noise, for the hi-hats, claps and crash. */
function whiteNoise (context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}
