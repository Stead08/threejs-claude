import { describe, expect, it } from "vitest";
import { synthJustChime, synthMissThud, synthSafeTock } from "./sfx-synth";
import type { SfxPcm } from "./sfx-synth";

const SAMPLE_RATE = 48000;

interface SynthCase {
  name: string;
  synth: (sampleRate: number) => SfxPcm;
  /** 期待する全長レンジ（秒）。 */
  minSec: number;
  maxSec: number;
}

const CASES: SynthCase[] = [
  { name: "synthJustChime", synth: synthJustChime, minSec: 0.3, maxSec: 0.4 },
  { name: "synthSafeTock", synth: synthSafeTock, minSec: 0.08, maxSec: 0.16 },
  { name: "synthMissThud", synth: synthMissThud, minSec: 0.2, maxSec: 0.3 },
];

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) {
      peak = v;
    }
  }
  return peak;
}

function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function countNonFinite(samples: Float32Array): number {
  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) {
      count++;
    }
  }
  return count;
}

for (const spec of CASES) {
  describe(spec.name, () => {
    const pcm = spec.synth(SAMPLE_RATE);

    it("長さが期待レンジ内で L/R が同じ長さ", () => {
      expect(pcm.left.length).toBeGreaterThanOrEqual(Math.floor(SAMPLE_RATE * spec.minSec));
      expect(pcm.left.length).toBeLessThanOrEqual(Math.ceil(SAMPLE_RATE * spec.maxSec));
      expect(pcm.right.length).toBe(pcm.left.length);
    });

    it("全サンプルが有限値", () => {
      expect(countNonFinite(pcm.left)).toBe(0);
      expect(countNonFinite(pcm.right)).toBe(0);
    });

    it("ピーク絶対値が 0 < peak <= 1", () => {
      const peak = peakOf(pcm.left);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(1);
    });

    it("無音でない（RMS > 0）", () => {
      expect(rmsOf(pcm.left)).toBeGreaterThan(0);
      expect(rmsOf(pcm.right)).toBeGreaterThan(0);
    });
  });
}
