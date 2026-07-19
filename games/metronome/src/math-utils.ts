// 演出用の小さな数値ユーティリティ。フレームループから呼ばれるため副作用・割り当てを持たない。

/** value を [min, max] へ収める。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 線形補間。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 減速イージング（0→1 の t を受け取る）。 */
export function easeOutQuad(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv;
}
