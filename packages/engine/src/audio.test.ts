// AudioEngine.unlock() の「吊るされない」挙動のテスト。
// iOS Safari には resume() / <audio>.play() の Promise が解決しないまま残る既知の問題があり
// （実測でロードが 90 秒以上停止）、unlock はそれらを無期限に待ってはならない。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio";

type StateChangeListener = () => void;

interface FakeAudioContext {
  state: string;
  sampleRate: number;
  resume: () => Promise<void>;
  createBuffer: () => object;
  createBufferSource: () => { buffer: object | null; connect: () => void; start: () => void };
  destination: object;
  addEventListener: (type: string, listener: StateChangeListener) => void;
  removeEventListener: (type: string, listener: StateChangeListener) => void;
  /** テスト側から statechange 発火を模擬する。 */
  fireStateChange: (state: string) => void;
}

function createFakeContext(options: {
  state: string;
  resume: () => Promise<void>;
}): FakeAudioContext {
  const listeners = new Set<StateChangeListener>();
  const ctx: FakeAudioContext = {
    state: options.state,
    sampleRate: 48000,
    resume: options.resume,
    createBuffer: (): object => ({}),
    createBufferSource: () => ({
      buffer: null,
      connect: (): void => {},
      start: (): void => {},
    }),
    destination: {},
    addEventListener: (type, listener): void => {
      if (type === "statechange") {
        listeners.add(listener);
      }
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
    fireStateChange: (state): void => {
      ctx.state = state;
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return ctx;
}

/** play() が永遠に解決しない <audio> 要素の代役。 */
function createHangingAudioElement(): HTMLAudioElement {
  return { loop: false, play: (): Promise<void> => new Promise(() => {}) } as HTMLAudioElement;
}

function createEngine(ctx: FakeAudioContext, audio?: HTMLAudioElement): AudioEngine {
  return new AudioEngine({
    context: ctx as unknown as AudioContext,
    audioElementFactory: () => audio ?? createHangingAudioElement(),
  });
}

describe("AudioEngine.unlock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resume() の Promise が解決しなくても statechange で running を検知して完了する", async () => {
    const ctx = createFakeContext({
      state: "suspended",
      // WebKit バグの模擬: state は遷移するが Promise は解決しない。
      resume: (): Promise<void> => {
        queueMicrotask(() => ctx.fireStateChange("running"));
        return new Promise(() => {});
      },
    });
    const steps: string[] = [];
    await createEngine(ctx).unlock({ onStep: (s) => steps.push(s) });
    expect(steps).toEqual(["silent-audio:play", "resume:start", "resume:done:running"]);
  });

  it("resume() が解決せず statechange も来なければタイムアウトで先へ進む", async () => {
    const ctx = createFakeContext({
      state: "suspended",
      resume: (): Promise<void> => new Promise(() => {}),
    });
    const steps: string[] = [];
    const done = createEngine(ctx).unlock({ onStep: (s) => steps.push(s) });
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(steps).toEqual(["silent-audio:play", "resume:start", "resume:done:suspended"]);
  });

  it("無音 <audio> の play() が解決しなくても unlock は完了する", async () => {
    const ctx = createFakeContext({
      state: "suspended",
      resume: (): Promise<void> => {
        ctx.state = "running";
        return Promise.resolve();
      },
    });
    await expect(createEngine(ctx, createHangingAudioElement()).unlock()).resolves.toBeUndefined();
  });

  it("iOS 固有の interrupted 状態でも resume を試みる", async () => {
    let resumed = false;
    const ctx = createFakeContext({
      state: "interrupted",
      resume: (): Promise<void> => {
        resumed = true;
        ctx.state = "running";
        return Promise.resolve();
      },
    });
    await createEngine(ctx).unlock();
    expect(resumed).toBe(true);
  });

  it("running 中は resume を呼ばない", async () => {
    const resume = vi.fn((): Promise<void> => Promise.resolve());
    const ctx = createFakeContext({ state: "running", resume });
    await createEngine(ctx).unlock();
    expect(resume).not.toHaveBeenCalled();
  });

  it("無音 <audio> の play() は resume 待ちより前（ジェスチャタスク内）に開始される", async () => {
    const order: string[] = [];
    const ctx = createFakeContext({
      state: "suspended",
      resume: (): Promise<void> => {
        order.push("resume");
        ctx.state = "running";
        return Promise.resolve();
      },
    });
    const audio = {
      loop: false,
      play: (): Promise<void> => {
        order.push("silent-play");
        return Promise.resolve();
      },
    } as HTMLAudioElement;
    await createEngine(ctx, audio).unlock();
    expect(order).toEqual(["silent-play", "resume"]);
  });

  it("play() 拒否時は rejected を通知し、次の pointerdown で 1 回だけ再試行する", async () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal("window", {
      addEventListener: (_type: string, listener: () => void): void => {
        listeners.push(listener);
      },
    });
    try {
      const ctx = createFakeContext({
        state: "suspended",
        resume: (): Promise<void> => {
          ctx.state = "running";
          return Promise.resolve();
        },
      });
      let playCalls = 0;
      const audio = {
        loop: false,
        play: (): Promise<void> => {
          playCalls += 1;
          // 1 回目はアクティベーション失効の拒否を模擬、2 回目は成功。
          return playCalls === 1
            ? Promise.reject(new DOMException("denied", "NotAllowedError"))
            : Promise.resolve();
        },
      } as HTMLAudioElement;
      const steps: string[] = [];
      await createEngine(ctx, audio).unlock({ onStep: (s) => steps.push(s) });
      // 拒否の通知はマイクロタスクで届く。
      await Promise.resolve();
      expect(steps).toContain("silent-audio:play:rejected:NotAllowedError");
      expect(listeners).toHaveLength(1);

      // 次のユーザ操作（pointerdown）で再試行され、成功が通知される。
      listeners[0]?.();
      await Promise.resolve();
      expect(playCalls).toBe(2);
      expect(steps).toContain("silent-audio:play:ok");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
