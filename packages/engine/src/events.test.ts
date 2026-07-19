import { describe, expect, it } from 'vitest';
import { decodeEvents, type EngineEvent } from './events';

describe('decodeEvents', () => {
  it('4 要素レコードを復号しレコード数を返す', () => {
    const flat = new Float64Array([2, 5, 1, -30]);
    const out: EngineEvent[] = [];
    const n = decodeEvents(flat, out);
    expect(n).toBe(1);
    expect(out[0]).toEqual({ type: 2, cueIndex: 5, a: 1, b: -30 });
  });

  it('端数（4 の倍数でない長さ）は floor する', () => {
    const flat = new Float64Array([1, 0, 3, 0.5, 9]); // 5 要素 → 1 レコード
    const out: EngineEvent[] = [];
    expect(decodeEvents(flat, out)).toBe(1);
    expect(out).toHaveLength(1);
  });

  it('空入力は 0 を返し out を変更しない', () => {
    const out: EngineEvent[] = [];
    expect(decodeEvents(new Float64Array(0), out)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('既存要素をミューテートして再利用する（新規オブジェクトを作らない）', () => {
    const out: EngineEvent[] = [];
    decodeEvents(new Float64Array([1, 2, 3, 4]), out);
    const first = out[0];
    // 2 回目は別値。同一オブジェクト参照が使い回されること。
    decodeEvents(new Float64Array([3, 7, 2, 0]), out);
    expect(out[0]).toBe(first);
    expect(out[0]).toEqual({ type: 3, cueIndex: 7, a: 2, b: 0 });
  });

  it('不足分のみ push する', () => {
    const out: EngineEvent[] = [];
    decodeEvents(new Float64Array([1, 0, 0, 0]), out);
    expect(out).toHaveLength(1);
    const first = out[0];
    // 2 レコードへ増加 → 1 件 push、既存は再利用。
    const n = decodeEvents(new Float64Array([1, 0, 0, 0, 2, 1, 1, 5]), out);
    expect(n).toBe(2);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(first);
    expect(out[1]).toEqual({ type: 2, cueIndex: 1, a: 1, b: 5 });
  });
});
