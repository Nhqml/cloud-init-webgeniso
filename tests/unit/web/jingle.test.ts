// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BEAT, type Note, discoJingle, midiToFrequency } from "../../../src/web/jingle.ts";

const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} ≈ ${expected}`);

const closeAll = (actual: number[], expected: number[]): void => {
  assert.equal(actual.length, expected.length, `${actual} vs ${expected}`);
  actual.forEach((value, i) => close(value, expected[i] ?? Number.NaN));
};

/** Start times in beats rather than seconds, to read like a score. */
const beats = (notes: Note[]): number[] => notes.map((note) => note.time / BEAT);

describe("midiToFrequency", () => {
  test("tunes A4 (MIDI 69) to 440 Hz, in equal temperament", () => {
    assert.equal(midiToFrequency(69), 440);
    assert.equal(midiToFrequency(57), 220);
    close(midiToFrequency(60), 261.63); // C4
  });
});

describe("discoJingle", () => {
  // Built per test, so each one reports its own failure.
  const jingle = (): Note[] => discoJingle();
  const of = (instrument: Note["instrument"]): Note[] =>
    jingle().filter((note) => note.instrument === instrument);
  const FINAL = 3; // The last beat, where everything lands.

  test("runs at 128 BPM, the classic disco tempo", () => {
    close(BEAT, 60 / 128);
  });

  test("lasts about two and a half seconds, final hit included", () => {
    const end = Math.max(...jingle().map((note) => note.time + note.duration));
    assert.ok(end > 2 && end < 2.6, `ends at ${end}`);
  });

  test("lists notes in time order", () => {
    const notes = jingle();
    assert.deepEqual(beats(notes), [...beats(notes)].sort((a, b) => a - b));
  });

  test("has a kick on every beat: four on the floor", () => {
    closeAll(beats(of("kick")), [0, 1, 2, 3]);
  });

  test("has handclaps on the backbeat, beats 2 and 4", () => {
    closeAll(beats(of("clap")), [1, 3]);
  });

  test("has open hi-hats on the off-beats, none after the final hit", () => {
    closeAll(beats(of("hat")), [0.5, 1.5, 2.5]);
  });

  test("has an octave bass line on eighth notes, then a long low final note", () => {
    const bass = of("bass");
    closeAll(beats(bass), [0, 0.5, 1, 1.5, 2, 2.5, FINAL]);
    for (let i = 0; i < 6; i += 2) {
      close((bass[i + 1]?.frequencies[0] ?? 0) / (bass[i]?.frequencies[0] ?? 1), 2);
    }
    assert.ok((bass.at(-1)?.duration ?? 0) >= 0.8);
  });

  test("builds up with two short stabs, then lands on a long A major chord", () => {
    const stabs = of("stab");
    closeAll(beats(stabs), [2, 2.5, FINAL]);
    assert.ok(stabs.slice(0, 2).every((stab) => stab.duration < 0.2));
    const final = stabs.at(-1);
    assert.ok((final?.duration ?? 0) >= 0.8);
    closeAll(final?.frequencies ?? [], [57, 61, 64, 69].map(midiToFrequency)); // A3 C#4 E4 A4
  });

  test("ends with every instrument landing together on the last beat", () => {
    const last = jingle().filter((note) => Math.abs(note.time / BEAT - FINAL) < 0.01);
    const instruments = new Set(last.map((note) => note.instrument));
    assert.deepEqual(instruments, new Set(["kick", "clap", "bass", "stab", "crash"]));
    assert.ok(jingle().every((note) => note.time / BEAT <= FINAL + 0.01), "nothing after it");
  });

  test("rings out the final hit with a crash cymbal", () => {
    const crash = of("crash");
    assert.equal(crash.length, 1);
    assert.ok((crash[0]?.duration ?? 0) >= 0.8);
  });

  test("gives pitches only to pitched instruments", () => {
    for (const note of jingle()) {
      const pitched = note.instrument === "bass" || note.instrument === "stab";
      assert.equal(note.frequencies.length > 0, pitched, note.instrument);
      assert.ok(note.frequencies.every((frequency) => frequency > 0));
      assert.ok(note.duration > 0);
    }
  });
});
