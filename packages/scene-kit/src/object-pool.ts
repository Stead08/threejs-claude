// ObjectPool<T>: フレームループでの new/GC を避けるための汎用オブジェクトプール。
// M0-SPEC §6: prealloc(n, factory) / acquire() / release(t)。acquire 時に在庫切れなら factory で補充。

/** 汎用オブジェクトプール。three のメッシュ等、生成コストのあるオブジェクトの使い回しに使う。 */
export class ObjectPool<T> {
  readonly #free: T[] = [];
  #factory: (() => T) | null;

  /** factory は省略可（未指定なら prealloc() で必ず渡すこと）。 */
  constructor(factory?: () => T) {
    this.#factory = factory ?? null;
  }

  /** n 個を factory で事前生成しプールへ積む。以後 acquire() の在庫切れ補充にもこの factory を使う。 */
  prealloc(n: number, factory: () => T): void {
    this.#factory = factory;
    for (let i = 0; i < n; i++) {
      this.#free.push(factory());
    }
  }

  /** プールから 1 個取り出す。在庫切れなら factory で新規生成する（factory 未設定なら例外）。 */
  acquire(): T {
    const item = this.#free.pop();
    if (item !== undefined) {
      return item;
    }
    if (this.#factory === null) {
      throw new Error("ObjectPool: factory is not set. Call prealloc() first.");
    }
    return this.#factory();
  }

  /** 使い終わったオブジェクトをプールへ返却する。 */
  release(t: T): void {
    this.#free.push(t);
  }

  /** 現在プールに待機している個数（デバッグ用）。 */
  get available(): number {
    return this.#free.length;
  }
}
