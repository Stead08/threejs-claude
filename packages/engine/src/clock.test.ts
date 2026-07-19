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
    // contextTime - performanceTime/1000 = offset。performanceTime は ms。
    const state = { perfMs: 0, audioSec: 0, ts: { contextTime: 1.5, performanceTime: 500 } };
    const clock = new AudioClock(makeSources(state));
    // 初回 offset = 1.5 - 0.5 = 1.0
    expect(clock.offset).toBeCloseTo(1.0, 9);

    // 次サンプルは offset=2.0 相当。audio 時刻を 2s 進めて更新ゲートを開く。
    state.ts = { contextTime: 2.5, performanceTime: 500 };
    state.audioSec = 2;
    clock.perfToAudio(0);
    // EMA: 0.9*1.0 + 0.1*2.0 = 1.1
    expect(clock.offset).toBeCloseTo(1.1, 9);

    // さらに更新（1s 未満では更新されないことも確認）。
    state.audioSec = 2.5; // 2.5 - 2 = 0.5 < 1 → 更新されない
    clock.perfToAudio(0);
    expect(clock.offset).toBeCloseTo(1.1, 9);

    state.audioSec = 3.1; // 3.1 - 2 = 1.1 >= 1 → 更新
    clock.perfToAudio(0);
    // EMA: 0.9*1.1 + 0.1*2.0 = 1.19
    expect(clock.offset).toBeCloseTo(1.19, 9);
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

  it('reset() は EMA 履歴を破棄して新しい対応を即時採用する', () => {
    // suspended 中（audio 時計停止・currentTime=0）に構築 → フォールバック offset は
    // ページ経過時間ぶんズレる（unlock 前のタイトル待機を再現）。
    const state = { perfMs: 60000, audioSec: 0, ts: null as { contextTime: number; performanceTime: number } | null };
    const clock = new AudioClock(makeSources(state));
    expect(clock.offset).toBeCloseTo(-60.0, 9); // 0 - 60 = -60（誤った対応）

    // unlock 後: audio 時計が走り出し、正しい対応は offset = 0.5 - 60.5 = -60 ... ではなく
    // running 中のペア contextTime=0.5, performanceTime=60500 → offset = 0.5 - 60.5 = -60.0
    // に「suspend していなかった場合」との差が現れるよう、実時間を進めた状況を作る:
    // タイトルで 60 秒待機 → unlock → audio は 0.5s、perf は 60500ms。
    state.perfMs = 60500;
    state.audioSec = 0.5;
    state.ts = { contextTime: 0.5, performanceTime: 60500 };
    clock.reset();
    // reset は EMA せず即時採用: offset = 0.5 - 60.5 = -60.0
    expect(clock.offset).toBeCloseTo(-60.0, 9);
    // 変換が正しい: 直後のタップ perf=60600ms → audio = 60.6 - 60.0 = 0.6s
    expect(clock.perfToAudio(60600)).toBeCloseTo(0.6, 9);
  });

  it('reset() は resume 後の平行移動した対応へ EMA を待たず追従する', () => {
    const state = { perfMs: 0, audioSec: 0, ts: { contextTime: 10.0, performanceTime: 10000 } };
    const clock = new AudioClock(makeSources(state));
    expect(clock.offset).toBeCloseTo(0.0, 9);

    // 30 秒 suspend: audio は 10s のまま、perf は 40000ms へ。resume 後の正対応は
    // offset = 10 - 40 = -30。EMA(α=0.1) なら 1 回で -3 までしか動かないが、
    // reset は即時 -30 を採用する。
    state.perfMs = 40000;
    state.audioSec = 10.0;
    state.ts = { contextTime: 10.0, performanceTime: 40000 };
    clock.reset();
    expect(clock.offset).toBeCloseTo(-30.0, 9);
  });
});
