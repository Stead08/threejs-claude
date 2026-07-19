// UI 効果音モジュール。Web Audio API でその場合成する（音声アセットは使わない）。
// AudioContext は初回呼び出し（＝ユーザジェスチャ内）で遅延生成するシングルトン。
// AudioContext 非対応・生成失敗環境では全関数が安全に no-op になる。

import type { RankGrade } from "./rank";

/** AudioContext コンストラクタ（webkit プレフィックス込み）。 */
type AudioContextCtor = new () => AudioContext;

interface AudioHandle {
  ctx: AudioContext;
  master: GainNode;
}

/** 1音ぶんの合成パラメータ。 */
interface ToneSpec {
  type: OscillatorType;
  /** 開始周波数 [Hz]。 */
  freq: number;
  /** 指数スイープの終端周波数 [Hz]（省略時はスイープなし）。 */
  endFreq?: number;
  /** ctx.currentTime からの相対開始時刻 [s]。 */
  at: number;
  /** 減衰込みの長さ [s]。 */
  duration: number;
  /** ピークゲイン（master 前の個別ゲイン）。 */
  gain: number;
}

const MASTER_GAIN = 0.5;

let singleton: AudioHandle | null = null;
let initFailed = false;

function resolveCtor(): AudioContextCtor | null {
  const g = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** シングルトン AudioContext を確保する。非対応/失敗時は null（以後も生成を試みない）。 */
function ensureAudio(): AudioHandle | null {
  if (initFailed) {
    return null;
  }
  try {
    if (singleton === null) {
      const Ctor = resolveCtor();
      if (Ctor === null) {
        initFailed = true;
        return null;
      }
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
      singleton = { ctx, master };
    }
    if (singleton.ctx.state === "suspended") {
      // ユーザジェスチャ内であれば再開される。await せず投げっぱなしで試行する。
      void singleton.ctx.resume().catch(() => {
        // 失敗しても次回呼び出しで再試行するだけなので握りつぶす。
      });
    }
    return singleton;
  } catch {
    initFailed = true;
    return null;
  }
}

/** oscillator + gain エンベロープで 1 音鳴らす。 */
function playTone(audio: AudioHandle, spec: ToneSpec): void {
  const start = audio.ctx.currentTime + spec.at;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.endFreq, start + spec.duration);
  }
  gain.gain.setValueAtTime(spec.gain, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
  osc.connect(gain);
  gain.connect(audio.master);
  osc.start(start);
  osc.stop(start + spec.duration + 0.02);
}

/** 複数音をまとめてスケジュールする（全体を try/catch で保護）。 */
function playTones(specs: ToneSpec[]): void {
  try {
    const audio = ensureAudio();
    if (audio === null) {
      return;
    }
    for (const spec of specs) {
      playTone(audio, spec);
    }
  } catch {
    // 音は演出であり失敗してもゲーム進行に影響させない。
  }
}

/** ボタンタップ用の短いチック音（~40ms、三角波 880→660Hz の指数減衰）。 */
export function uiTapSound(): void {
  playTones([{ type: "triangle", freq: 880, endFreq: 660, at: 0, duration: 0.04, gain: 0.12 }]);
}

/** 決定操作用の上昇 2 音ブリップ（660→990Hz、~120ms）。 */
export function uiConfirmSound(): void {
  playTones([
    { type: "triangle", freq: 660, at: 0, duration: 0.06, gain: 0.15 },
    { type: "triangle", freq: 990, at: 0.06, duration: 0.09, gain: 0.15 },
  ]);
}

/**
 * リザルトのランクに応じたアルペジオを鳴らす。
 *   - high + perfect: メジャーアルペジオ 4 音 + オクターブ上のきらめき（~0.9s）
 *   - high:           3 音アルペジオ
 *   - ok:             控えめな 2 音
 *   - retry:          低めの単音
 */
export function playResultJingle(grade: RankGrade, perfect: boolean): void {
  if (grade === "retry") {
    playTones([{ type: "triangle", freq: 220, at: 0, duration: 0.4, gain: 0.1 }]);
    return;
  }
  if (grade === "ok") {
    playTones([
      { type: "triangle", freq: 440, at: 0, duration: 0.22, gain: 0.12 },
      { type: "triangle", freq: 659.25, at: 0.15, duration: 0.28, gain: 0.12 },
    ]);
    return;
  }
  // high: A メジャーアルペジオ（A4 / C#5 / E5）。
  const specs: ToneSpec[] = [
    { type: "triangle", freq: 440, at: 0, duration: 0.28, gain: 0.16 },
    { type: "triangle", freq: 554.37, at: 0.12, duration: 0.28, gain: 0.16 },
    { type: "triangle", freq: 659.25, at: 0.24, duration: 0.32, gain: 0.16 },
  ];
  if (perfect) {
    // 4 音目（A5）+ オクターブ上のきらめき 2 音で ~0.9s の華やかさにする。
    specs.push(
      { type: "triangle", freq: 880, at: 0.36, duration: 0.36, gain: 0.16 },
      { type: "sine", freq: 1760, at: 0.55, duration: 0.25, gain: 0.08 },
      { type: "sine", freq: 2217.46, at: 0.68, duration: 0.22, gain: 0.07 },
    );
  }
  playTones(specs);
}
