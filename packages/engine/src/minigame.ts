// Minigame 契約型（PLAN §5 概形を M0 向けに具体化）。engine が定義し games/* が実装する。

import type { AudioEngine } from './audio';
import type { AudioClock } from './clock';
import type { EngineEvent } from './events';

/** 入力動詞の定義（タップ / ホールド / フリック等）。M0 はタップのみ使用。 */
export interface VerbSpec {
  id: number;
  name: string;
}

/** ゲームへ engine が渡す実行コンテキスト。 */
export interface MinigameContext {
  audio: AudioEngine;
  clock: AudioClock;
  /** チャートアセットの URL ベース。 */
  assetBase: string;
  /** ゲーム → シェルへの結果通知。 */
  onFinished(statsJson: string): void;
}

/** 3D 演出シーン。フレームループとイベントを受ける。 */
export interface MinigameScene {
  /** 毎フレーム。songPosSec は曲位置（秒）。 */
  update(nowSec: number, songPosSec: number): void;
  /** tick イベント → 演出。 */
  handleEvent(ev: EngineEvent): void;
  /** リサイズ。 */
  resize(w: number, h: number, dpr: number): void;
  /** 破棄。 */
  dispose(): void;
}

/** ミニゲーム契約。 */
export interface Minigame {
  id: string;
  verbs: VerbSpec[];
  /** 譜面・SF2・3D アセットのロード。onProgress は 0..1。 */
  load(ctx: MinigameContext, onProgress: (r: number) => void): Promise<void>;
  /** 3D シーンの構築。 */
  createScene(canvas: HTMLCanvasElement): MinigameScene;
  /** 曲再生開始 + ループ開始。 */
  start(): void;
  /** 停止。 */
  stop(): void;
}
