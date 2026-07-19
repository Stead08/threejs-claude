// Zustand vanilla store + React バインド（M0-SPEC §8）。
// store 自体をエクスポートし、ゲームループ側（非 React）からも getState()/setState 経由で書き込める。

import { CalibrationStore } from "@rhythm/engine";
import type { Calibration, StorageLike } from "@rhythm/engine";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

/** localStorage が使えない環境（テスト実行等）向けのフォールバック実装。 */
function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
  };
}

function resolveStorage(): StorageLike {
  // Cookie ブロック環境（サードパーティ iframe 等）では localStorage への
  // 「プロパティアクセス自体」が SecurityError を throw するため try で包む。
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    // メモリフォールバックへ。
  }
  return createMemoryStorage();
}

/** キャリブレーション値の永続化ストア（localStorage key: rhythm.calibration.v1）。 */
export const calibrationStore = new CalibrationStore(resolveStorage());

export type AppState = "title" | "loading" | "play" | "result";

export interface ShellState {
  appState: AppState;
  loadProgress: number;
  resultJson: string | null;
  calibration: Calibration;
  settingsOpen: boolean;
  tutorialOpen: boolean;

  setAppState: (appState: AppState) => void;
  setLoadProgress: (ratio: number) => void;
  /** ゲーム側 onFinished からの結果通知。result 画面へ遷移する。 */
  setResult: (statsJson: string) => void;
  setCalibration: (calibration: Calibration) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openTutorial: () => void;
  closeTutorial: () => void;
  /** タイトルへ戻す（もういちど用に進捗/結果をリセット）。 */
  resetToTitle: () => void;
}

/** シェル全体の vanilla store。ゲームループから `shellStore.getState().setAppState(...)` のように書ける。 */
export const shellStore = createStore<ShellState>((set) => ({
  appState: "title",
  loadProgress: 0,
  resultJson: null,
  calibration: calibrationStore.get(),
  settingsOpen: false,
  tutorialOpen: false,

  setAppState: (appState): void => set({ appState }),
  setLoadProgress: (ratio): void => set({ loadProgress: ratio }),
  setResult: (statsJson): void => set({ resultJson: statsJson, appState: "result" }),
  setCalibration: (calibration): void => {
    calibrationStore.set(calibration);
    set({ calibration });
  },
  openSettings: (): void => set({ settingsOpen: true }),
  closeSettings: (): void => set({ settingsOpen: false }),
  openTutorial: (): void => set({ tutorialOpen: true }),
  closeTutorial: (): void => set({ tutorialOpen: false }),
  resetToTitle: (): void => set({ appState: "title", loadProgress: 0, resultJson: null }),
}));

/** React コンポーネントから shellStore を購読するためのフック。 */
export function useShellStore<T>(selector: (state: ShellState) => T): T {
  return useStore(shellStore, selector);
}
