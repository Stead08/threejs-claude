// Just 判定演出用の星形ジオメトリ生成。ThreeShape → ShapeGeometry のフラットな星（一度だけ生成して共有される想定）。

import { Shape, ShapeGeometry } from 'three';

/** outerRadius/innerRadius の頂点を交互に結んだ points 個の角を持つ星形ジオメトリを作る。 */
export function createStarGeometry(
  outerRadius: number,
  innerRadius: number,
  points: number,
): ShapeGeometry {
  const shape = new Shape();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = i * step - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }
  shape.closePath();
  return new ShapeGeometry(shape);
}
