// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Plays the disco jingle with Web Audio, synthesizing every instrument, so
// nothing is downloaded. Kept thin, like main.ts: what plays and when is in
// jingle.ts, which is unit-tested. Loaded on demand by main.ts.

import { type Note, discoJingle } from "./jingle.ts";

/** Overall loudness, from 0 to 1: noticeable, not startling. */
const VOLUME = 0.25;

/**
 * Plays the jingle on `context`, which the caller creates during the click
 * (some browsers only let audio start inside a user gesture), then closes
 * the context once the jingle is over.
 */
export function playDiscoJingle(context: AudioContext): void {
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

function play(
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
function envelope(
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
function playNoise(
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
function whiteNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}
