// apps/web エントリポイント（M0-SPEC §9）。合成の唯一の場所として engine/shell/ゲームを束ねる。
//
// フロー: Title タップ → audio.unlock() → appState='loading' → game.load(ctx, onProgress)
//         → createScene(canvas) → appState='play' → game.start()
//         → MinigameContext.onFinished(statsJson) → store へ結果 → appState='result'
//         → 「もういちど」→ 再スタート

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AudioEngine, fromAudioContext } from "@rhythm/engine";
import type { AudioClock, Minigame, MinigameContext, MinigameScene } from "@rhythm/engine";
import { AppShell, shellStore } from "@rhythm/shell";

/** ゲームレジストリ。動的 import によりコード分割される（M0 は metronome の 1 本のみ）。 */
const games: Record<string, () => Promise<{ default: Minigame }>> = {
  metronome: () => import("@rhythm/game-metronome"),
};

const ACTIVE_GAME_ID = "metronome";
const MAX_DEVICE_PIXEL_RATIO = 2;

function requireCanvas(id: string): HTMLCanvasElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error(`#${id} は canvas 要素として見つかりませんでした`);
  }
  return el;
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`#${id} 要素が見つかりませんでした`);
  }
  return el;
}

const canvas = requireCanvas("game");
const rootEl = requireElement("root");

// AudioEngine/AudioClock はアプリ全体で単一。MinigameContext 経由でゲームへ渡す。
const audioEngine = new AudioEngine();
const clock: AudioClock = fromAudioContext(audioEngine.context);
// resume 直後は perf ⇄ audio の対応が suspend 時間ぶん平行移動しているため、クロックを即時再確立する。
audioEngine.attachVisibilityAutoSuspend(document, () => clock.reset());

let currentGame: Minigame | null = null;
let currentScene: MinigameScene | null = null;

function resizeCurrentScene(): void {
  if (currentScene === null) {
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
  currentScene.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener("resize", resizeCurrentScene);

/** ゲーム→シェルへの結果通知。ループとシーン（HUD 含む）を破棄してリザルトへ遷移する。 */
function handleFinished(statsJson: string): void {
  currentGame?.stop();
  // dispose しないとデバッグ HUD（DOM 直更新）がリザルト画面の上に残留する。
  currentScene?.dispose();
  currentScene = null;
  currentGame = null;
  shellStore.getState().setResult(statsJson);
}

/** タイトルタップ時のメインフロー。失敗時はタイトルへ戻す。 */
async function startGame(): Promise<void> {
  try {
    await audioEngine.unlock();
    // AudioClock はモジュールロード時（suspended 中）に構築されており、その時点の
    // フォールバック offset はタイトル画面での待機時間ぶんズレている。running に
    // なった今、正しい対応で即時再確立する（プレイ冒頭のタップ変換ズレの防止）。
    clock.reset();

    const state = shellStore.getState();
    state.setLoadProgress(0);
    state.setAppState("loading");

    const loadGame = games[ACTIVE_GAME_ID];
    if (loadGame === undefined) {
      throw new Error(`未登録のゲームです: ${ACTIVE_GAME_ID}`);
    }
    const mod = await loadGame();
    const game = mod.default;

    const ctx: MinigameContext = {
      audio: audioEngine,
      clock,
      assetBase: import.meta.env.BASE_URL,
      onFinished: handleFinished,
    };

    await game.load(ctx, (ratio: number): void => {
      shellStore.getState().setLoadProgress(ratio);
    });

    const scene = game.createScene(canvas);
    currentGame = game;
    currentScene = scene;
    resizeCurrentScene();

    shellStore.getState().setAppState("play");
    game.start();
  } catch (err) {
    // ロード/開始に失敗したらタイトルへ戻す（次のタップでやり直せる）。
    console.error("[main] failed to start game", err);
    shellStore.getState().resetToTitle();
    throw err;
  }
}

/**
 * 「もういちど」。games/metronome の Session/内部状態を再構築する `reset()` 相当の API が
 * Minigame 契約に無いため（M0-SPEC §5）、多重 start() 呼び出しの安全性を games/* 側の実装に
 * 依存させず確実に再現するためリロードで再スタートする（§9「リロードでも可」）。
 */
function retryGame(): void {
  window.location.reload();
}

const reactRoot = createRoot(rootEl);
reactRoot.render(
  <StrictMode>
    <AppShell onStart={startGame} onRetry={retryGame} />
  </StrictMode>,
);
