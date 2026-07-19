// rank.ts の境界テスト（docs/M0-SPEC.md §8 のランク規則）。

import { describe, expect, it } from "vitest";
import { rank, type Stats } from "./rank";

function makeStats(overrides: Partial<Stats>): Stats {
  return {
    totalCues: 100,
    judged: 100,
    just: 100,
    safe: 0,
    miss: 0,
    meanMs: 0,
    stdMs: 0,
    histogram: { fromMs: -100, binMs: 10, counts: [] },
    ...overrides,
  };
}

describe("rank", () => {
  it("miss率がちょうど20%はretryにならない（>20%のみretry）", () => {
    const stats = makeStats({
      totalCues: 10,
      miss: 2,
      judged: 8,
      just: 0,
      safe: 8,
      meanMs: 5,
      stdMs: 5,
    });
    expect(rank(stats).rank).not.toBe("retry");
  });

  it("miss率が20%を超えるとretry", () => {
    const stats = makeStats({ totalCues: 100, miss: 21, judged: 79 });
    expect(rank(stats)).toEqual({ rank: "retry", perfect: false });
  });

  it("miss率5%・|mean|20ms・σ30msちょうどはhigh（境界は以下で含む）", () => {
    const stats = makeStats({ totalCues: 100, miss: 5, judged: 95, meanMs: 20, stdMs: 30 });
    expect(rank(stats)).toEqual({ rank: "high", perfect: false });
  });

  it("meanが20msをわずかに超えるとhighにならない", () => {
    const stats = makeStats({ totalCues: 100, miss: 5, meanMs: 20.1, stdMs: 0 });
    expect(rank(stats).rank).toBe("ok");
  });

  it("meanが-20msちょうどはhigh（絶対値で判定）", () => {
    const stats = makeStats({ totalCues: 100, miss: 5, meanMs: -20, stdMs: 30 });
    expect(rank(stats).rank).toBe("high");
  });

  it("meanが-20.1msはhighにならない", () => {
    const stats = makeStats({ totalCues: 100, miss: 5, meanMs: -20.1, stdMs: 0 });
    expect(rank(stats).rank).toBe("ok");
  });

  it("σが30msをわずかに超えるとhighにならない", () => {
    const stats = makeStats({ totalCues: 100, miss: 5, meanMs: 0, stdMs: 30.1 });
    expect(rank(stats).rank).toBe("ok");
  });

  it("miss率が5%を超える（6%）場合はhighにならずok", () => {
    const stats = makeStats({ totalCues: 100, miss: 6, meanMs: 0, stdMs: 0 });
    expect(rank(stats).rank).toBe("ok");
  });

  it("miss===0はrankに関わらずperfect", () => {
    const stats = makeStats({ totalCues: 100, miss: 0, meanMs: 999, stdMs: 999 });
    const result = rank(stats);
    expect(result.perfect).toBe(true);
    expect(result.rank).toBe("ok");
  });

  it("missが0かつmean/σが範囲内ならhighかつperfect", () => {
    const stats = makeStats({ totalCues: 100, miss: 0, meanMs: 0, stdMs: 0 });
    expect(rank(stats)).toEqual({ rank: "high", perfect: true });
  });

  it("totalCuesが0でもゼロ除算せずmiss率0として扱う", () => {
    const stats = makeStats({
      totalCues: 0,
      judged: 0,
      just: 0,
      safe: 0,
      miss: 0,
      meanMs: 0,
      stdMs: 0,
    });
    expect(rank(stats)).toEqual({ rank: "high", perfect: true });
  });
});
