// vitest 用の wasm スタブ。wasm-pkg（wasm-pack の生成物）は未ビルドのことがあるため、
// packages/shell/vitest.config.ts の alias で '../wasm-pkg/rhythm_wasm.js' をこのファイルへ差し替え、
// store.test.ts などが @rhythm/engine（index 経由で wasm.ts を含む）を import できるようにする。
// 実際に呼び出されることは想定しない（呼ばれたら throw する）。

/** wasm-pack の init 相当のスタブ。 */
export default function init(): Promise<never> {
  return Promise.reject(new Error("rhythm_wasm stub: not available in tests"));
}

/** renderNote 相当のスタブ。 */
export function renderNote(): never {
  throw new Error("rhythm_wasm stub: not available in tests");
}

/** Session 相当のスタブ。 */
export class Session {
  constructor() {
    throw new Error("rhythm_wasm stub: not available in tests");
  }

  /** wasm-bindgen 生成クラスの free() 相当。 */
  free(): void {
    throw new Error("rhythm_wasm stub: not available in tests");
  }
}
