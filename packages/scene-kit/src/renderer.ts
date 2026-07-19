// createGameRenderer: WebGLRenderer の生成とライフサイクル管理（resize/dispose）。
// M0-SPEC §6: antialias, alpha:false / pixelRatio <= 2 / sRGB 出力。

import { SRGBColorSpace, WebGLRenderer } from 'three';

/** ピクセル比の上限（モバイル GPU 予算対策）。 */
const MAX_PIXEL_RATIO = 2;

export interface GameRenderer {
  /** 生成済みの WebGLRenderer 本体。シーン側の render() 呼び出しに使う。 */
  readonly renderer: WebGLRenderer;
  /** 描画サイズ・ピクセル比を更新する。 */
  resize(width: number, height: number, dpr: number): void;
  /** GPU リソースを解放する。 */
  dispose(): void;
}

function clampPixelRatio(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) {
    return 1;
  }
  return Math.min(dpr, MAX_PIXEL_RATIO);
}

/** ゲーム用 WebGLRenderer を生成する。canvas の初期サイズには関与しない（呼び側が resize() すること）。 */
export function createGameRenderer(canvas: HTMLCanvasElement): GameRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;

  const initialDpr =
    typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  renderer.setPixelRatio(clampPixelRatio(initialDpr));

  return {
    renderer,
    resize(width: number, height: number, dpr: number): void {
      renderer.setPixelRatio(clampPixelRatio(dpr));
      // false: canvas の CSS サイズは呼び側（レイアウト）に委ね、描画バッファのみ更新する。
      renderer.setSize(width, height, false);
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}
