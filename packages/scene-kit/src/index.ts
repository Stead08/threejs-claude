// packages/scene-kit の公開エクスポート（M0-SPEC §6）。
// three ^0.185 のみに依存。engine を含む他パッケージには依存しない。

export { createGameRenderer } from './renderer';
export type { GameRenderer } from './renderer';

export { createToonMaterial } from './toon-material';

export { addOutline } from './outline';

export { PortraitCameraRig } from './camera-rig';
export type { PortraitCameraRigOptions } from './camera-rig';

export { ObjectPool } from './object-pool';
