// リザルトのランク判定（純関数）。docs/M0-SPEC.md §8 の規則に厳密準拠。
// Session.statsJson() の出力（camelCase の JSON）を Stats に対応させる。

/** 誤差ヒストグラム（statsJson の histogram フィールド）。 */
export interface RankHistogram {
  fromMs: number;
  binMs: number;
  counts: number[];
}

/** wasm Session.statsJson() の出力に対応する統計値。 */
export interface Stats {
  totalCues: number;
  judged: number;
  just: number;
  safe: number;
  miss: number;
  meanMs: number;
  stdMs: number;
  histogram: RankHistogram;
}

export type RankGrade = "retry" | "ok" | "high";

export interface RankResult {
  rank: RankGrade;
  perfect: boolean;
}

/** ランク表示名（日本語）。 */
export const RANK_LABELS: Record<RankGrade, string> = {
  retry: "やりなおし",
  ok: "平凡",
  high: "ハイレベル",
};

/** ノーミス時の勲章表示名。 */
export const PERFECT_LABEL = "パーフェクト";

const RETRY_MISS_RATE = 0.2;
const HIGH_MISS_RATE = 0.05;
const HIGH_MEAN_ABS_MS = 20;
const HIGH_STD_MS = 30;

/**
 * stats からランクと perfect フラグを決定する純関数（副作用なし）。
 * 規則（境界値は「以上/以下」の等号側に注意）:
 *   - miss率 > 20%                              → retry
 *   - miss率 <= 5% かつ |mean| <= 20ms かつ σ <= 30ms → high
 *   - それ以外                                    → ok
 *   - miss === 0（実数、率ではない）              → perfect = true
 * totalCues <= 0 の場合は miss率を 0 とみなす（キューが無いチャートを retry 扱いにしないため）。
 */
export function rank(stats: Stats): RankResult {
  const missRate = stats.totalCues > 0 ? stats.miss / stats.totalCues : 0;
  const perfect = stats.miss === 0;

  if (missRate > RETRY_MISS_RATE) {
    return { rank: "retry", perfect };
  }
  if (
    missRate <= HIGH_MISS_RATE &&
    Math.abs(stats.meanMs) <= HIGH_MEAN_ABS_MS &&
    stats.stdMs <= HIGH_STD_MS
  ) {
    return { rank: "high", perfect };
  }
  return { rank: "ok", perfect };
}
