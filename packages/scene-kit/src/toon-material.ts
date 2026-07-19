// createToonMaterial: MeshToonMaterial + 共有 3 段グラデーションマップ。
// M0-SPEC §6: 3 段 DataTexture グラデーションマップ（NearestFilter）を一度だけ生成して共有する。

import { DataTexture, MeshToonMaterial, NearestFilter, RedFormat } from 'three';
import type { ColorRepresentation } from 'three';

/** トゥーンシェーディングの段数（暗 / 中 / 明の 3 段）。 */
const GRADIENT_STEPS = 3;

let sharedGradientMap: DataTexture | null = null;

/** 3 段グラデーションマップを一度だけ生成し、以後は同一インスタンスを共有する。 */
function getSharedGradientMap(): DataTexture {
  if (sharedGradientMap !== null) {
    return sharedGradientMap;
  }
  const data = new Uint8Array(GRADIENT_STEPS);
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    // 0..255 を 3 段に均等割り（0 段目=暗部, 最終段=明部）。
    data[i] = Math.round((255 * (i + 1)) / GRADIENT_STEPS);
  }
  const texture = new DataTexture(data, GRADIENT_STEPS, 1, RedFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  sharedGradientMap = texture;
  return texture;
}

/** ローポリ・トゥーン用の MeshToonMaterial を生成する。gradientMap は全マテリアルで共有される。 */
export function createToonMaterial(color: ColorRepresentation): MeshToonMaterial {
  return new MeshToonMaterial({
    color,
    gradientMap: getSharedGradientMap(),
  });
}
