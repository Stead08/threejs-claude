// ui-sfx の非対応環境フォールバックテスト。
// node 環境には AudioContext が無いため、全関数が no-op として throw しないことを確認する。

import { describe, expect, it } from "vitest";
import { playResultJingle, uiConfirmSound, uiTapSound } from "./ui-sfx";
import type { RankGrade } from "./rank";

describe("ui-sfx (AudioContext 非対応環境)", () => {
  it("uiTapSound が throw しない", () => {
    expect(() => uiTapSound()).not.toThrow();
  });

  it("uiConfirmSound が throw しない", () => {
    expect(() => uiConfirmSound()).not.toThrow();
  });

  it("playResultJingle が全ランク × perfect の組み合わせで throw しない", () => {
    const grades: RankGrade[] = ["retry", "ok", "high"];
    for (const grade of grades) {
      expect(() => playResultJingle(grade, false)).not.toThrow();
      expect(() => playResultJingle(grade, true)).not.toThrow();
    }
  });

  it("連続呼び出しでも throw しない（シングルトン初期化失敗後の no-op 継続）", () => {
    expect(() => {
      uiTapSound();
      uiTapSound();
      uiConfirmSound();
    }).not.toThrow();
  });
});
