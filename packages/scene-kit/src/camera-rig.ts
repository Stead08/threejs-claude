// PortraitCameraRig: 縦画面向けカメラリグ。fov は縦基準（three の PerspectiveCamera.fov はもともと
// 垂直 FOV なので、横幅ベースの補正はせずそのまま使う）。shake() は減衰付きの手ぶれオフセット。
// M0-SPEC §6。

import { PerspectiveCamera, Vector3 } from "three";
import type { Vector3Tuple } from "three";

const DEFAULT_FOV = 55;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 100;
/** 縦持ちのデフォルトアスペクト比（9:16）。実サイズは resize() で更新される。 */
const DEFAULT_ASPECT = 9 / 16;
const DEFAULT_POSITION: Vector3Tuple = [0, 4, 9];
const DEFAULT_LOOK_AT: Vector3Tuple = [0, 2, 0];
/** shake 強度の減衰速度（1 秒あたりの指数減衰係数）。大きいほど早く収まる。 */
const DEFAULT_SHAKE_DECAY_PER_SEC = 6;
/** この閾値未満になったら shake を打ち切る（無限に微小計算を続けない）。 */
const SHAKE_EPSILON = 1e-4;

export interface PortraitCameraRigOptions {
  fov?: number;
  near?: number;
  far?: number;
  aspect?: number;
  position?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  shakeDecayPerSec?: number;
}

/** 縦画面用カメラリグ。base position + shake オフセットを毎フレーム合成してカメラへ反映する。 */
export class PortraitCameraRig {
  readonly camera: PerspectiveCamera;

  readonly #basePosition = new Vector3();
  readonly #lookAtTarget = new Vector3();
  /** シェイクの再利用オフセットベクトル（フレーム内 new 禁止）。 */
  readonly #shakeOffset = new Vector3();
  #shakeStrength = 0;
  readonly #shakeDecayPerSec: number;

  constructor(options: PortraitCameraRigOptions = {}) {
    const fov = options.fov ?? DEFAULT_FOV;
    const near = options.near ?? DEFAULT_NEAR;
    const far = options.far ?? DEFAULT_FAR;
    const aspect = options.aspect ?? DEFAULT_ASPECT;
    this.camera = new PerspectiveCamera(fov, aspect, near, far);

    const position = options.position ?? DEFAULT_POSITION;
    this.#basePosition.set(position[0], position[1], position[2]);
    const lookAt = options.lookAt ?? DEFAULT_LOOK_AT;
    this.#lookAtTarget.set(lookAt[0], lookAt[1], lookAt[2]);
    this.#shakeDecayPerSec = options.shakeDecayPerSec ?? DEFAULT_SHAKE_DECAY_PER_SEC;

    this.camera.position.copy(this.#basePosition);
    this.camera.lookAt(this.#lookAtTarget);
  }

  /** カメラの基準位置（shake を含まない）を更新する。 */
  setBasePosition(x: number, y: number, z: number): void {
    this.#basePosition.set(x, y, z);
  }

  /** lookAt の固定注視点を更新する。 */
  setLookAt(x: number, y: number, z: number): void {
    this.#lookAtTarget.set(x, y, z);
  }

  /**
   * 手ぶれを加える。既存のシェイクより弱ければ無視せず、強い方を採用する
   * （小さい判定の後に大きい判定が来ても埋もれないように）。
   */
  shake(strength: number): void {
    if (strength > this.#shakeStrength) {
      this.#shakeStrength = strength;
    }
  }

  /** リサイズ時にアスペクト比を更新する。 */
  resize(width: number, height: number): void {
    if (height <= 0) {
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 毎フレーム呼ぶ。shake の減衰とカメラの位置/向き更新を行う（ヒープ割り当てなし）。 */
  update(dt: number): void {
    if (this.#shakeStrength > SHAKE_EPSILON) {
      this.#shakeStrength *= Math.exp(-this.#shakeDecayPerSec * dt);
      if (this.#shakeStrength <= SHAKE_EPSILON) {
        this.#shakeStrength = 0;
      }
      const s = this.#shakeStrength;
      this.#shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0);
    } else {
      this.#shakeOffset.set(0, 0, 0);
    }

    this.camera.position.set(
      this.#basePosition.x + this.#shakeOffset.x,
      this.#basePosition.y + this.#shakeOffset.y,
      this.#basePosition.z + this.#shakeOffset.z,
    );
    this.camera.lookAt(this.#lookAtTarget);
  }
}
