// 判定効果音（Just / Safe / Miss）の PCM をその場合成する純関数群。
// ロード時に 1 回だけ呼ばれる想定のためアロケーションは自由（フレームループからは呼ばない）。
// 各関数は sampleRate を受け取り、L/R 同一内容のステレオ PCM を返す。

/** 合成した効果音のステレオ PCM（L/R は同一内容）。 */
export interface SfxPcm {
  left: Float32Array;
  right: Float32Array;
}

/** Just チャイムの全長（秒）。 */
const JUST_DURATION_SEC = 0.35;
/** Just チャイムのピーク目標。 */
const JUST_PEAK = 0.6;
/** Safe トックの全長（秒）。 */
const SAFE_DURATION_SEC = 0.12;
/** Safe トックのピーク目標。 */
const SAFE_PEAK = 0.5;
/** Miss ドスンの全長（秒）。 */
const MISS_DURATION_SEC = 0.25;
/** Miss ドスンのピーク目標。 */
const MISS_PEAK = 0.55;

const TWO_PI = Math.PI * 2;

/**
 * Just 判定のチャイム音を合成する。
 * 設計意図: E6/B6/E7（1319/1976/2637Hz）のサイン部分音を 1 : 0.5 : 0.25 で重ねた
 * 明るいベル和音。アタック約 2ms で立ち上げ、指数減衰で約 0.35 秒かけて消える。
 * 高次部分音ほど弱くすることで金属的な倍音感を出しつつ耳に刺さらないようにする。
 */
export function synthJustChime(sampleRate: number): SfxPcm {
  const length = Math.round(sampleRate * JUST_DURATION_SEC);
  const mono = new Float32Array(length);
  // 部分音: [周波数 Hz, 振幅] の組。
  const partials: ReadonlyArray<readonly [number, number]> = [
    [1319, 1],
    [1976, 0.5],
    [2637, 0.25],
  ];
  // 減衰レート 14/s → 0.35s 時点で exp(-4.9) ≈ 0.007（十分に無音へ収束）。
  const decayPerSec = 14;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const env = attackEnvelope(t, 0.002) * Math.exp(-decayPerSec * t);
    let sample = 0;
    for (const [freq, amp] of partials) {
      sample += Math.sin(TWO_PI * freq * t) * amp;
    }
    mono[i] = sample * env;
  }
  normalizePeak(mono, JUST_PEAK);
  return toStereo(mono);
}

/**
 * Safe 判定のトック音を合成する。
 * 設計意図: 約 520Hz から 400Hz へピッチが落ちる短いサイン。ウッドブロックを叩いた
 * ような「コツ」という木質な打音を狙う。全長約 0.12 秒と短く、Just のベルより
 * 地味な響きにすることで判定の格差を音でも伝える。
 */
export function synthSafeTock(sampleRate: number): SfxPcm {
  const length = Math.round(sampleRate * SAFE_DURATION_SEC);
  const mono = new Float32Array(length);
  // 減衰レート 35/s → 0.12s 時点で exp(-4.2) ≈ 0.015。
  const decayPerSec = 35;
  // 周波数が時間変化するため位相を積分して波形を作る（周波数の不連続を防ぐ）。
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const progress = i / length;
    const freq = lerp(520, 400, progress);
    phase += (TWO_PI * freq) / sampleRate;
    const env = attackEnvelope(t, 0.001) * Math.exp(-decayPerSec * t);
    mono[i] = Math.sin(phase) * env;
  }
  normalizePeak(mono, SAFE_PEAK);
  return toStereo(mono);
}

/**
 * Miss（AutoMiss）のドスン音を合成する。
 * 設計意図: 160Hz から 70Hz へ急降下するサインで「落下して床にぶつかる」低音を作り、
 * 冒頭約 30ms の減衰ホワイトノイズを重ねて衝突のアタック感（打撃ノイズ）を加える。
 * 全長約 0.25 秒。低く鈍い音で失敗を明確に伝える。
 */
export function synthMissThud(sampleRate: number): SfxPcm {
  const length = Math.round(sampleRate * MISS_DURATION_SEC);
  const mono = new Float32Array(length);
  // 本体サインの減衰レート 18/s → 0.25s 時点で exp(-4.5) ≈ 0.011。
  const decayPerSec = 18;
  // ノイズは 150/s で減衰 → 30ms 時点で exp(-4.5) ≈ 0.011（実質冒頭のみ）。
  const noiseDecayPerSec = 150;
  const noise = createNoiseSource(0x1234abcd);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const progress = i / length;
    const freq = lerp(160, 70, progress);
    phase += (TWO_PI * freq) / sampleRate;
    const env = attackEnvelope(t, 0.002) * Math.exp(-decayPerSec * t);
    const noiseEnv = Math.exp(-noiseDecayPerSec * t);
    mono[i] = Math.sin(phase) * env + noise() * noiseEnv * 0.6;
  }
  normalizePeak(mono, MISS_PEAK);
  return toStereo(mono);
}

/** 線形補間。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** クリックノイズ防止の線形アタック（attackSec で 0→1）。 */
function attackEnvelope(t: number, attackSec: number): number {
  return Math.min(1, t / attackSec);
}

/**
 * テストの再現性のため乱数は固定シードの線形合同法で生成する（Math.random 非依存）。
 * 返り値は [-1, 1) の一様乱数を返すクロージャ。
 */
function createNoiseSource(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    // Numerical Recipes の LCG 定数。32bit で回して [-1, 1) へ正規化する。
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

/** ピーク絶対値が targetPeak になるよう全体をスケールする（無音なら何もしない）。 */
function normalizePeak(samples: Float32Array, targetPeak: number): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) {
      peak = v;
    }
  }
  if (peak <= 0) {
    return;
  }
  const gain = targetPeak / peak;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] ?? 0) * gain;
  }
}

/** モノラル波形を L/R 同一内容のステレオへ複製する。 */
function toStereo(mono: Float32Array): SfxPcm {
  return { left: mono, right: mono.slice() };
}
