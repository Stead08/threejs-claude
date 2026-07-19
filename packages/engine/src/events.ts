// tick が返すフラットなイベントレコード（4 × f64 / 件）をオブジェクト列へ復号する。
// 毎フレーム呼ばれるため、割り当てゼロ（out の既存要素をミューテートして再利用）で実装する。

/**
 * デコード済みイベント。§4 の 4 要素レコードに対応。
 * type: 1=CueApproach / 2=Judged / 3=AutoMiss。
 * a, b はレコード列の [2], [3]（type ごとに意味が異なる）。
 */
export interface EngineEvent {
  type: number;
  cueIndex: number;
  a: number;
  b: number;
}

/**
 * flat（[type, cueIndex, a, b] × N）を out へ復号する。
 * out の既存要素はミューテートで再利用し、不足分のみ push する。
 * 返り値は復号したレコード数（out の先頭からこの件数が有効）。
 */
export function decodeEvents(flat: Float64Array, out: EngineEvent[]): number {
  const count = Math.floor(flat.length / 4);
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const type = flat[base] ?? 0;
    const cueIndex = flat[base + 1] ?? 0;
    const a = flat[base + 2] ?? 0;
    const b = flat[base + 3] ?? 0;
    const existing = out[i];
    if (existing === undefined) {
      out.push({ type, cueIndex, a, b });
    } else {
      existing.type = type;
      existing.cueIndex = cueIndex;
      existing.a = a;
      existing.b = b;
    }
  }
  return count;
}
