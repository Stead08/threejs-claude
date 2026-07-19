// addOutline: インバーテッドハル方式の輪郭線。ポストプロセスなしで輪郭を出す（PLAN §2 方針）。
// M0-SPEC §6: 同ジオメトリ再利用の BackSide メッシュを子として追加して返す。

import { BackSide, Mesh, MeshBasicMaterial } from "three";
import type { ColorRepresentation } from "three";

const DEFAULT_SCALE = 1.03;
const DEFAULT_COLOR: ColorRepresentation = 0x000000;

/**
 * mesh のジオメトリを再利用したインバーテッドハル（裏面のみ描画・拡大）を子として追加する。
 * ジオメトリは mesh と共有のため輪郭側での dispose は不要だが、**マテリアルは輪郭が
 * 新規生成して所有する**ので、呼び側が返り値の `.material` を破棄経路に登録すること。
 */
export function addOutline(
  mesh: Mesh,
  scale: number = DEFAULT_SCALE,
  color: ColorRepresentation = DEFAULT_COLOR,
): Mesh {
  const material = new MeshBasicMaterial({ color, side: BackSide });
  const outline = new Mesh(mesh.geometry, material);
  outline.scale.setScalar(scale);
  // 輪郭はライティングの影響を受けない・影も落とさない。
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
  return outline;
}
