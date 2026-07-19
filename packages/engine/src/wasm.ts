// wasm ブリッジ。crates/wasm が wasm-pack で生成する ../wasm-pkg/rhythm_wasm.js を薄くラップする。
// 注: wasm-pkg は後続の wasm-pack ビルドで生成されるため、typecheck 時点では
// '../wasm-pkg/rhythm_wasm.js' の解決エラーが出るが、これは想定内（他エラーは無し）。

import init, { renderNote, Session } from '../wasm-pkg/rhythm_wasm.js';

/** 判定・接近設定。config_json として wasm へ渡す。 */
export interface SessionConfig {
  justMs: number;
  safeMs: number;
  approachSec: number;
}

/** レンダ済み単発ノート（SFX 用）。 */
export interface RenderedNote {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/** Session の TS 側ハンドル。 */
export interface SessionHandle {
  /** 毎フレーム 1 回。inputs は [timeSec, verb] × K。戻りは [type, cueIndex, a, b] × N。 */
  tick(nowSec: number, inputs: Float64Array): Float64Array;
  /** 統計 JSON。 */
  statsJson(): string;
  /** 曲長（秒）。 */
  readonly durationSec: number;
  /** キュー総数。 */
  readonly cueCount: number;
  /** キュー列（[timeSec, beat, kind] × N）。 */
  cuesFlat(): Float64Array;
  /** 全キュー判定済み or 曲終了か。 */
  finished(nowSec: number): boolean;
}

let initPromise: Promise<void> | null = null;

/** wasm を初期化する。多重呼び出しは同一 Promise を返す。 */
export function initWasm(): Promise<void> {
  if (initPromise === null) {
    initPromise = init().then(() => undefined);
  }
  return initPromise;
}

/** Session を生成して TS 側ハンドルを返す。initWasm() 完了後に呼ぶこと。 */
export function createSession(
  midi: Uint8Array,
  overlayJson: string,
  config: SessionConfig,
): SessionHandle {
  const session = new Session(midi, overlayJson, JSON.stringify(config));
  // durationSec / cueCount は不変なので生成時にキャッシュする。
  const durationSec: number = session.durationSec();
  const cueCount: number = session.cueCount();
  return {
    tick: (nowSec: number, inputs: Float64Array): Float64Array => session.tick(nowSec, inputs),
    statsJson: (): string => session.statsJson(),
    durationSec,
    cueCount,
    cuesFlat: (): Float64Array => session.cuesFlat(),
    finished: (nowSec: number): boolean => session.finished(nowSec),
  };
}

/** 単発ノートをレンダする（タップ SFX 用）の薄いラッパ。 */
export function renderNoteBuffer(
  sf2: Uint8Array,
  percussion: boolean,
  preset: number,
  key: number,
  velocity: number,
  durationSec: number,
  sampleRate: number,
): RenderedNote {
  const result = renderNote(sf2, percussion, preset, key, velocity, durationSec, sampleRate);
  return {
    sampleRate: result.sampleRate,
    left: result.left,
    right: result.right,
  };
}
