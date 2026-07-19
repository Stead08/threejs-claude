import { describe, expect, it } from "vitest";
import { AudioClock, type ClockSources } from "./clock";
import { InputQueue } from "./input";

/** offset=0 の恒等クロック（perfToAudio(ms) = ms/1000）。 */
function identityClock(): AudioClock {
  const sources: ClockSources = {
    perfNowMs: () => 0,
    audioCurrentTimeSec: () => 0,
    outputTimestamp: () => null, // フォールバック: offset = 0 - 0 = 0
  };
  return new AudioClock(sources);
}

/** ハンドラを捕捉して手動発火できる EventTarget モック。 */
class FakeTarget implements EventTarget {
  readonly handlers = new Map<string, EventListener>();
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === "function") {
      this.handlers.set(type, listener);
    }
  }
  removeEventListener(type: string): void {
    this.handlers.delete(type);
  }
  dispatchEvent(): boolean {
    return true;
  }
  fire(type: string, ev: { timeStamp: number; code?: string; repeat?: boolean }): void {
    const handler = this.handlers.get(type);
    if (handler !== undefined) {
      handler(ev as unknown as Event);
    }
  }
}

describe("InputQueue", () => {
  it("pointerdown を audio 時刻へ変換して積む", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target);
    target.fire("pointerdown", { timeStamp: 1000 });
    target.fire("pointerdown", { timeStamp: 2000 });
    const out = queue.drain();
    expect(Array.from(out)).toEqual([1.0, 0, 2.0, 0]);
  });

  it("inputOffsetMs が時刻へ反映される", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock(), { inputOffsetMs: 50 });
    queue.attach(target);
    target.fire("pointerdown", { timeStamp: 1000 });
    expect(queue.drain()[0]).toBeCloseTo(1.05, 9);

    queue.setInputOffsetMs(-30);
    target.fire("pointerdown", { timeStamp: 1000 });
    expect(queue.drain()[0]).toBeCloseTo(0.97, 9);
  });

  it("onTap がタップ時刻で即時に呼ばれる", () => {
    const target = new FakeTarget();
    const seen: number[] = [];
    const queue = new InputQueue(identityClock(), { onTap: (t) => seen.push(t) });
    queue.attach(target);
    target.fire("pointerdown", { timeStamp: 500 });
    expect(seen).toEqual([0.5]);
  });

  it("keydown は Space のみ、repeat は除外", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target);
    target.fire("keydown", { timeStamp: 1000, code: "KeyA", repeat: false });
    target.fire("keydown", { timeStamp: 2000, code: "Space", repeat: true });
    target.fire("keydown", { timeStamp: 3000, code: "Space", repeat: false });
    const out = queue.drain();
    expect(Array.from(out)).toEqual([3.0, 0]);
  });

  it("drain は同一バッファの subarray を返す（再利用）", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target);
    target.fire("pointerdown", { timeStamp: 1000 });
    const d1 = queue.drain();
    target.fire("pointerdown", { timeStamp: 2000 });
    const d2 = queue.drain();
    expect(d1.buffer).toBe(d2.buffer);
    // drain 後は空。
    expect(queue.drain()).toHaveLength(0);
  });

  it("容量 64 を超えると最古を捨て、64 件を順序保持で返す", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target);
    // 65 件（event0..event64、timeStamp = index ms）。
    for (let i = 0; i < 65; i++) {
      target.fire("pointerdown", { timeStamp: i });
    }
    const out = queue.drain();
    expect(out).toHaveLength(64 * 2);
    // event0 が捨てられ、先頭は event1（0.001s）、末尾は event64（0.064s）。
    expect(out[0]).toBeCloseTo(0.001, 9);
    expect(out[out.length - 2]).toBeCloseTo(0.064, 9);
    expect(out[out.length - 1]).toBe(0);
  });

  it("detach 後はイベントを積まない", () => {
    const target = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target);
    queue.detach();
    target.fire("pointerdown", { timeStamp: 1000 });
    expect(queue.drain()).toHaveLength(0);
  });

  it("keyboardTarget を分離できる（pointer は target、keydown は keyboardTarget）", () => {
    const target = new FakeTarget();
    const keyboard = new FakeTarget();
    const queue = new InputQueue(identityClock());
    queue.attach(target, keyboard);
    // keydown は keyboardTarget 側のみで受ける（canvas はフォーカス不能のため window を渡す想定）。
    expect(target.handlers.has("keydown")).toBe(false);
    expect(keyboard.handlers.has("keydown")).toBe(true);
    keyboard.fire("keydown", { timeStamp: 1500, code: "Space", repeat: false });
    target.fire("pointerdown", { timeStamp: 2000 });
    expect(Array.from(queue.drain())).toEqual([1.5, 0, 2.0, 0]);
    // detach で両方外れる。
    queue.detach();
    keyboard.fire("keydown", { timeStamp: 3000, code: "Space", repeat: false });
    expect(queue.drain()).toHaveLength(0);
  });
});
