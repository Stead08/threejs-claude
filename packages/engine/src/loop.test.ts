import { describe, expect, it } from "vitest";
import { GameLoop } from "./loop";

/** 手動駆動できる rAF スタブ。 */
function makeRaf(): {
  raf: (cb: (t: number) => void) => number;
  caf: (h: number) => void;
  step(t: number): void;
  pending(): boolean;
} {
  let stored: ((t: number) => void) | null = null;
  let handle = 0;
  return {
    raf: (cb) => {
      stored = cb;
      return ++handle;
    },
    caf: () => {
      stored = null;
    },
    step: (t) => {
      const cb = stored;
      stored = null;
      if (cb !== null) {
        cb(t);
      }
    },
    pending: () => stored !== null,
  };
}

describe("GameLoop", () => {
  it("注入 raf で駆動され、cb に rAF 時刻（秒）を渡す", () => {
    const r = makeRaf();
    const loop = new GameLoop({ raf: r.raf, caf: r.caf });
    const seen: number[] = [];
    loop.start((nowSec) => {
      seen.push(nowSec);
    });
    r.step(0);
    r.step(16);
    r.step(32);
    expect(seen).toEqual([0, 0.016, 0.032]);
  });

  it("fps を EMA 更新し、metrics オブジェクトは再利用する", () => {
    const r = makeRaf();
    let nowVal = 0;
    const loop = new GameLoop({ raf: r.raf, caf: r.caf, now: () => nowVal });
    const metrics = loop.metrics;
    loop.start((_nowSec) => {
      // cb 実行に 4ms かかる想定。
      nowVal += 4;
    });
    // frame0: 初回、fps 未確定。tickMs = 4。
    r.step(0);
    expect(loop.metrics).toBe(metrics); // 同一参照
    expect(metrics.tickMs).toBeCloseTo(4, 9);
    // frame1: dt=16 → instFps=62.5（初回なので直接採用）。
    r.step(16);
    expect(metrics.fps).toBeCloseTo(62.5, 6);
    // frame2: dt=16 → 62.5。EMA: 0.9*62.5 + 0.1*62.5 = 62.5。
    r.step(32);
    expect(metrics.fps).toBeCloseTo(62.5, 6);
  });

  it("fps は変動時に EMA で平滑化される", () => {
    const r = makeRaf();
    const loop = new GameLoop({ raf: r.raf, caf: r.caf, now: () => 0 });
    loop.start(() => {});
    r.step(0);
    r.step(10); // dt=10 → 100fps（初回サンプル）
    expect(loop.metrics.fps).toBeCloseTo(100, 6);
    r.step(30); // dt=20 → 50fps。EMA: 0.9*100 + 0.1*50 = 95
    expect(loop.metrics.fps).toBeCloseTo(95, 6);
  });

  it("stop でループが止まる", () => {
    const r = makeRaf();
    const loop = new GameLoop({ raf: r.raf, caf: r.caf });
    let calls = 0;
    loop.start(() => {
      calls++;
    });
    r.step(0);
    r.step(16);
    loop.stop();
    expect(r.pending()).toBe(false);
    expect(calls).toBe(2);
  });
});
