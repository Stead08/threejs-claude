// wasm Session.statsJson() の文字列出力を Stats へ安全に変換する（any 不使用・unknown で絞り込み）。

import type { RankHistogram, Stats } from "./rank";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function parseHistogram(value: unknown): RankHistogram {
  if (typeof value !== "object" || value === null) {
    return { fromMs: -100, binMs: 10, counts: [] };
  }
  const obj = value as Record<string, unknown>;
  const fromMs = obj["fromMs"];
  const binMs = obj["binMs"];
  const counts = obj["counts"];
  return {
    fromMs: isFiniteNumber(fromMs) ? fromMs : -100,
    binMs: isFiniteNumber(binMs) ? binMs : 10,
    counts: isFiniteNumberArray(counts) ? counts : [],
  };
}

/**
 * statsJson を Stats へ変換する。JSON として不正、または必須フィールドが数値でない場合は null。
 * Result 画面はこの戻り値が null のときフォールバック表示を出す。
 */
export function parseStats(json: string): Stats | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const totalCues = obj["totalCues"];
  const judged = obj["judged"];
  const just = obj["just"];
  const safe = obj["safe"];
  const miss = obj["miss"];
  const meanMs = obj["meanMs"];
  const stdMs = obj["stdMs"];
  if (
    !isFiniteNumber(totalCues) ||
    !isFiniteNumber(judged) ||
    !isFiniteNumber(just) ||
    !isFiniteNumber(safe) ||
    !isFiniteNumber(miss) ||
    !isFiniteNumber(meanMs) ||
    !isFiniteNumber(stdMs)
  ) {
    return null;
  }
  return {
    totalCues,
    judged,
    just,
    safe,
    miss,
    meanMs,
    stdMs,
    histogram: parseHistogram(obj["histogram"]),
  };
}
