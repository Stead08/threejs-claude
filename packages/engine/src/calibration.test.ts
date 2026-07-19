import { describe, expect, it } from "vitest";
import { CalibrationStore, type StorageLike } from "./calibration";

class MockStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const KEY = "rhythm.calibration.v1";

describe("CalibrationStore", () => {
  it("未保存なら既定値を返す", () => {
    const store = new CalibrationStore(new MockStorage());
    expect(store.get()).toEqual({ inputOffsetMs: 0, videoOffsetMs: 0 });
  });

  it("set した値を get で取り出せる", () => {
    const storage = new MockStorage();
    const store = new CalibrationStore(storage);
    store.set({ inputOffsetMs: 42, videoOffsetMs: -17 });
    expect(storage.getItem(KEY)).not.toBeNull();
    expect(store.get()).toEqual({ inputOffsetMs: 42, videoOffsetMs: -17 });
  });

  it("破損 JSON は既定値へフォールバック", () => {
    const storage = new MockStorage();
    storage.setItem(KEY, "{not valid json");
    const store = new CalibrationStore(storage);
    expect(store.get()).toEqual({ inputOffsetMs: 0, videoOffsetMs: 0 });
  });

  it("欠損フィールドはフィールドごとに既定値", () => {
    const storage = new MockStorage();
    storage.setItem(KEY, JSON.stringify({ inputOffsetMs: 10 }));
    const store = new CalibrationStore(storage);
    expect(store.get()).toEqual({ inputOffsetMs: 10, videoOffsetMs: 0 });
  });

  it("非数値フィールドは既定値", () => {
    const storage = new MockStorage();
    storage.setItem(KEY, JSON.stringify({ inputOffsetMs: "x", videoOffsetMs: null }));
    const store = new CalibrationStore(storage);
    expect(store.get()).toEqual({ inputOffsetMs: 0, videoOffsetMs: 0 });
  });

  it("JSON 配列など非オブジェクトは既定値", () => {
    const storage = new MockStorage();
    storage.setItem(KEY, JSON.stringify([1, 2, 3]));
    const store = new CalibrationStore(storage);
    expect(store.get()).toEqual({ inputOffsetMs: 0, videoOffsetMs: 0 });
  });
});
