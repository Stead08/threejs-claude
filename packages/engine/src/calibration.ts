// キャリブレーション値（入力オフセット / 映像オフセット）を Storage 互換に永続化する。

/** 判定用の入力オフセットと表示用の映像オフセット（いずれもミリ秒）。 */
export interface Calibration {
  inputOffsetMs: number;
  videoOffsetMs: number;
}

/** localStorage 互換の最小インタフェース（注入式）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CALIBRATION_KEY = 'rhythm.calibration.v1';
const DEFAULT_CALIBRATION: Calibration = { inputOffsetMs: 0, videoOffsetMs: 0 };

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalize(parsed: unknown): Calibration {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...DEFAULT_CALIBRATION };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    inputOffsetMs: coerceNumber(obj['inputOffsetMs'], DEFAULT_CALIBRATION.inputOffsetMs),
    videoOffsetMs: coerceNumber(obj['videoOffsetMs'], DEFAULT_CALIBRATION.videoOffsetMs),
  };
}

/** キャリブレーション値の get/set。破損 JSON は既定値へフォールバックする。 */
export class CalibrationStore {
  readonly #storage: StorageLike;

  constructor(storage: StorageLike) {
    this.#storage = storage;
  }

  /** 保存済みの値を返す。未保存/破損時は既定値。 */
  get(): Calibration {
    const raw = this.#storage.getItem(CALIBRATION_KEY);
    if (raw === null) {
      return { ...DEFAULT_CALIBRATION };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return normalize(parsed);
    } catch {
      return { ...DEFAULT_CALIBRATION };
    }
  }

  /** 値を保存する。 */
  set(calibration: Calibration): void {
    const payload: Calibration = {
      inputOffsetMs: calibration.inputOffsetMs,
      videoOffsetMs: calibration.videoOffsetMs,
    };
    this.#storage.setItem(CALIBRATION_KEY, JSON.stringify(payload));
  }
}
