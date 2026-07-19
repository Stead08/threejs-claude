// store の tutorialOpen トグル検証（settingsOpen と同じパターン）。

import { describe, expect, it } from "vitest";
import { shellStore } from "./store";

describe("shellStore のチュートリアル開閉", () => {
  it("初期状態では tutorialOpen が false", () => {
    expect(shellStore.getState().tutorialOpen).toBe(false);
  });

  it("openTutorial で true になり closeTutorial で false に戻る", () => {
    shellStore.getState().openTutorial();
    expect(shellStore.getState().tutorialOpen).toBe(true);
    shellStore.getState().closeTutorial();
    expect(shellStore.getState().tutorialOpen).toBe(false);
  });

  it("openTutorial は冪等（連続呼び出しでも true のまま）", () => {
    shellStore.getState().openTutorial();
    shellStore.getState().openTutorial();
    expect(shellStore.getState().tutorialOpen).toBe(true);
    shellStore.getState().closeTutorial();
  });
});
