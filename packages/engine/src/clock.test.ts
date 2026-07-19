import { describe, expect, it } from 'vitest';
import { AudioClock, type ClockSources } from './clock';

/** 可変な時刻ソースを組み立てるヘルパ。 */
function makeSources(state: {
  perfMs: number;
  audioSec: number;
  ts: { contextTime: number; performanceTime: number } | null;
}): ClockSources {
  return {
    perfNowMs: () => state.perfMs,
    audioCurrentTimeSec: () => state.audioSec,
    outputTimestamp: () => state.ts,
  };
}

describe('AudioClock', () => {
  it('outputTimestamp の初回サンプルを offset に採用する', () => {
    const state = { perfMs: 0, audioSec: 0, ts: { contextTime: 3.5, performanceTime: 1000 } };
    const clock = new AudioClock(makeSources(state));
    // offset = contextTime - performanceTime/1000 = 3.5 - 1.0 = 2.5
    expect(clock.offset).toBeCloseTo(2.5, 9);
  });

  it('perfToAudio = perfMs/1000 + offset', () => {
    const state = { perfMs: 0, audioSec: 0, ts: { contextTime: 2.0, performanceTime: 500 } };
    const clock = new AudioClock(makeSources(state));
    // offset = 2.0 - 0.5 = 1.5
    expect(clock.perfToAudio(1000)).toBeCloseTo(1.0 + 1.5, 9);
    expect(clock.perfToAudio(0)).toBeCloseTo(1.5, 9);
  });

  it('2 サンプル目以降を EMA(α=0.1) で平滑化する', () => {
    const state = { perfMs: 0, audioSec: 0, ts: { contextTime: 1.0, performanceTime: 0.001 } };
    const clock = new AudioClock(makeSources(state));
    // 初回 offset ≒ 1.0（performanceTime/1000 ≒ 0）
    expect(clock.offset).toBeCloseTo(1.0, 6);

    // 次サンプルは offset=2.0 相当。audio 時刻を 2s 進めて更新ゲートを開く。
    state.ts = { contextTime: 2.0, performanceTime: 0.001 };
    state.audioSec = 2;
    clock.perfToAudio(0);
    // EMA: 0.9*1.0 + 0.1*2.0 = 1.1
    expect(clock.offset).toBeCloseTo(1.1, 6);

    // さらに更新（1s 未満では更新されないことも確認）。
    state.audioSec = 2.5; // 2.5 - 2 = 0.5 < 1 → 更新されない
    clock.perfToAudio(0);
    expect(clock.offset).toBeCloseTo(1.1, 6);

    state.audioSec = 3.1; // 3.1 - 2 = 1.1 >= 1 → 更新
    clock.perfToAudio(0);
    // EMA: 0.9*1.1 + 0.1*2.0 = 1.19
    expect(clock.offset).toBeCloseTo(1.19, 6);
  });

  it('outputTimestamp が null ならフォールバック(currentTime - perfNow/1000)', () => {
    const state = { perfMs: 1000, audioSec: 5, ts: null };
    const clock = new AudioClock(makeSources(state));
    // offset = 5 - 1.0 = 4.0
    expect(clock.offset).toBeCloseTo(4.0, 9);
    expect(clock.perfToAudio(2000)).toBeCloseTo(2.0 + 4.0, 9);
  });

  it('0 値ペアはフォールバック扱い', () => {
    const state = { perfMs: 500, audioSec: 3, ts: { contextTime: 0, performanceTime: 0 } };
    const clock = new AudioClock(makeSources(state));
    // フォールバック: 3 - 0.5 = 2.5
    expect(clock.offset).toBeCloseTo(2.5, 9);
  });
});
