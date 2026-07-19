// デバッグ HUD: DOM オーバレイへ直接 textContent を書き込む（React 不使用）。
// fps / tickMs / just:safe:miss / mean±σms / 誤差ヒストグラムを 250ms 間隔で更新する。

import type { JudgeStatsAccumulator } from './judge-stats';

/** HUD の更新間隔（秒）。 */
const UPDATE_INTERVAL_SEC = 0.25;
/** ヒストグラムの棒文字（8 段階、低→高）。 */
const BAR_CHARS = '▁▂▃▄▅▆▇█';

export class DebugHud {
  readonly #el: HTMLDivElement;
  #lastUpdateSec = Number.NEGATIVE_INFINITY;
  #fps = 0;
  #tickMs = 0;

  constructor(parent: HTMLElement = document.body) {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.right = '0';
    el.style.padding = '4px 8px';
    el.style.font = '11px/1.4 monospace';
    el.style.color = '#7CFC7C';
    el.style.background = 'rgba(0,0,0,0.55)';
    el.style.whiteSpace = 'pre';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1000';
    el.style.textShadow = '0 1px 1px rgba(0,0,0,0.8)';
    parent.appendChild(el);
    this.#el = el;
  }

  /** GameLoop.metrics（fps/tickMs）を反映する。次回 update() で表示に使われる。 */
  setLoopMetrics(fps: number, tickMs: number): void {
    this.#fps = fps;
    this.#tickMs = tickMs;
  }

  /** 250ms 未満の間隔では何もしない（DOM 更新頻度を抑える）。 */
  update(nowSec: number, stats: JudgeStatsAccumulator): void {
    if (nowSec - this.#lastUpdateSec < UPDATE_INTERVAL_SEC) {
      return;
    }
    this.#lastUpdateSec = nowSec;
    this.#el.textContent =
      `fps:${this.#fps.toFixed(1)} tick:${this.#tickMs.toFixed(2)}ms\n` +
      `just:${stats.just} safe:${stats.safe} miss:${stats.miss}\n` +
      `err: ${stats.meanMs.toFixed(1)}±${stats.stdMs.toFixed(1)}ms\n` +
      renderHistogram(stats.histogram);
  }

  dispose(): void {
    this.#el.remove();
  }
}

/** 20 ビンのカウント配列を 20 文字の棒グラフ文字列にする。 */
function renderHistogram(counts: Uint32Array): string {
  let max = 1;
  for (let i = 0; i < counts.length; i++) {
    const v = counts[i] ?? 0;
    if (v > max) {
      max = v;
    }
  }
  let out = '';
  for (let i = 0; i < counts.length; i++) {
    const v = counts[i] ?? 0;
    const level = Math.min(BAR_CHARS.length - 1, Math.floor((v / max) * (BAR_CHARS.length - 1)));
    out += BAR_CHARS.charAt(level);
  }
  return out;
}
