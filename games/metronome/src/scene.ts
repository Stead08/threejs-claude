// メトロノームゲームの 3D シーン（M0-SPEC §7）。ローポリ・トゥーン、縦構図。
// 下 1/3 にヒットリング。CueApproach で奥からキュー玉をスポーンし、リングへ接近させる。
// 判定結果に応じて Just=金色フラッシュ+星形スケールアウト+カメラ shake / Safe=よろけ退場 / Miss=落下。
// 全オブジェクトはプール済みで、フレーム内 new を行わない。

import {
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Scene,
  TorusGeometry,
} from 'three';
import {
  ObjectPool,
  PortraitCameraRig,
  addOutline,
  createGameRenderer,
  createToonMaterial,
} from '@rhythm/scene-kit';
import type { GameRenderer } from '@rhythm/scene-kit';
import type { EngineEvent, MinigameScene } from '@rhythm/engine';

import { DebugHud } from './hud';
import { JudgeStatsAccumulator } from './judge-stats';
import { clamp, easeOutQuad, lerp } from './math-utils';
import { createStarGeometry } from './star-geometry';

/** createSession() の approachSec と一致させること（M0-SPEC §7: 1.0 秒 = 2 拍 @120BPM）。 */
const APPROACH_SEC = 1.0;

const SPAWN_POS = { x: 0, y: 14, z: -28 } as const;
const RING_POS = { x: 0, y: 1.4, z: 5 } as const;
const CAMERA_POSITION: [number, number, number] = [0, 6, 13];
const CAMERA_LOOK_AT: [number, number, number] = [0, 3, -6];

const ARC_HEIGHT = 3.2;
const BAR_HEAD_SCALE = 1.4;

const JUST_DURATION_SEC = 0.45;
const SAFE_DURATION_SEC = 0.5;
const MISS_DURATION_SEC = 0.6;
const STAR_DURATION_SEC = 0.4;

const CUE_CAPACITY = 24;
const STAR_CAPACITY = 8;

const SHAKE_JUST_STRENGTH = 0.35;

const COLOR_BACKGROUND = 0x11131c;
const COLOR_GROUND = 0x27301f;
const COLOR_RING = 0xdfe6f2;
const COLOR_CUE_NEUTRAL = 0x7f9cff;
const COLOR_CUE_JUST = 0xffd54a;
const COLOR_CUE_SAFE = 0x4a90ff;
const COLOR_CUE_MISS = 0xff4a4a;
const COLOR_STAR = 0xffe066;
const COLOR_OUTLINE = 0x101014;

const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 844;

type CuePhase = 'approach' | 'just' | 'safe' | 'miss';

interface CueEntry {
  readonly mesh: Mesh;
  readonly material: MeshToonMaterial;
  cueIndex: number;
  kind: number;
  targetSec: number;
  phase: CuePhase;
  phaseTimeSec: number;
  baseScale: number;
}

interface StarEntry {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  timeSec: number;
}

interface Disposable {
  dispose(): void;
}

/** 全キュー玉が共有するジオメトリ（ローポリ、一度だけ生成）。 */
const CUE_GEOMETRY = new IcosahedronGeometry(0.6, 0);
/** 全 Just 演出が共有する星形ジオメトリ。 */
const STAR_GEOMETRY = createStarGeometry(0.9, 0.4, 5);

function createCueEntry(threeScene: Scene, disposables: Disposable[]): CueEntry {
  const material = createToonMaterial(COLOR_CUE_NEUTRAL);
  disposables.push(material);
  const mesh = new Mesh(CUE_GEOMETRY, material);
  const outline = addOutline(mesh, 1.06, COLOR_OUTLINE);
  // 輪郭マテリアルは addOutline が新規生成して所有する（ジオメトリは共有）ため破棄登録する。
  disposables.push(outline.material as Disposable);
  mesh.visible = false;
  threeScene.add(mesh);
  return {
    mesh,
    material,
    cueIndex: -1,
    kind: 0,
    targetSec: 0,
    phase: 'approach',
    phaseTimeSec: 0,
    baseScale: 1,
  };
}

function createStarEntry(threeScene: Scene, disposables: Disposable[]): StarEntry {
  const material = new MeshBasicMaterial({
    color: COLOR_STAR,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
  });
  disposables.push(material);
  const mesh = new Mesh(STAR_GEOMETRY, material);
  mesh.visible = false;
  threeScene.add(mesh);
  return { mesh, material, timeSec: 0 };
}

function findFreeSlot<T>(slots: ReadonlyArray<T | null>): number {
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null || slots[i] === undefined) {
      return i;
    }
  }
  return -1;
}

function findSlotByCueIndex(slots: ReadonlyArray<CueEntry | null>, cueIndex: number): number {
  for (let i = 0; i < slots.length; i++) {
    const entry = slots[i];
    if (entry !== null && entry !== undefined && entry.cueIndex === cueIndex) {
      return i;
    }
  }
  return -1;
}

/** メトロノームゲームの MinigameScene 実装。index.ts から createScene() 経由で生成される。 */
export class MetronomeScene implements MinigameScene {
  readonly #gameRenderer: GameRenderer;
  readonly #threeScene: Scene;
  readonly #cameraRig: PortraitCameraRig;
  readonly #hud: DebugHud;
  readonly #stats = new JudgeStatsAccumulator();
  readonly #disposables: Disposable[] = [];

  readonly #cuePool = new ObjectPool<CueEntry>();
  readonly #cueSlots: Array<CueEntry | null> = Array.from({ length: CUE_CAPACITY }, () => null);

  readonly #starPool = new ObjectPool<StarEntry>();
  readonly #starSlots: Array<StarEntry | null> = Array.from({ length: STAR_CAPACITY }, () => null);

  #lastNowSec: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#gameRenderer = createGameRenderer(canvas);
    this.#threeScene = new Scene();
    this.#threeScene.background = new Color(COLOR_BACKGROUND);

    const width = canvas.clientWidth > 0 ? canvas.clientWidth : DEFAULT_WIDTH;
    const height = canvas.clientHeight > 0 ? canvas.clientHeight : DEFAULT_HEIGHT;
    this.#cameraRig = new PortraitCameraRig({
      fov: 55,
      aspect: width / height,
      position: CAMERA_POSITION,
      lookAt: CAMERA_LOOK_AT,
    });
    const dpr = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
    this.#gameRenderer.resize(width, height, dpr);

    this.#threeScene.add(new HemisphereLight(0xddeeff, 0x223322, 0.95));
    const dirLight = new DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(5, 10, 7);
    this.#threeScene.add(dirLight);

    const groundGeometry = new CircleGeometry(30, 24);
    const groundMaterial = createToonMaterial(COLOR_GROUND);
    this.#disposables.push(groundGeometry, groundMaterial);
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    this.#threeScene.add(ground);

    const ringGeometry = new TorusGeometry(1.6, 0.22, 8, 24);
    const ringMaterial = createToonMaterial(COLOR_RING);
    this.#disposables.push(ringGeometry, ringMaterial);
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.position.set(RING_POS.x, RING_POS.y, RING_POS.z);
    const ringOutline = addOutline(ring, 1.05, COLOR_OUTLINE);
    this.#disposables.push(ringOutline.material as Disposable);
    this.#threeScene.add(ring);

    this.#cuePool.prealloc(CUE_CAPACITY, () => createCueEntry(this.#threeScene, this.#disposables));
    this.#starPool.prealloc(STAR_CAPACITY, () =>
      createStarEntry(this.#threeScene, this.#disposables),
    );

    this.#hud = new DebugHud();
  }

  /** GameLoop.metrics（fps/tickMs）を HUD へ反映する。MinigameScene 契約外の拡張メソッド。 */
  setLoopMetrics(fps: number, tickMs: number): void {
    this.#hud.setLoopMetrics(fps, tickMs);
  }

  handleEvent(ev: EngineEvent): void {
    switch (ev.type) {
      case 1: // CueApproach: a=kind, b=targetSec
        this.#spawnCue(ev.cueIndex, ev.a, ev.b);
        break;
      case 2: // Judged: a=judgment(0=Just/1=Safe), b=errorMs
        this.#judgeCue(ev.cueIndex, ev.a, ev.b);
        break;
      case 3: // AutoMiss
        this.#missCue(ev.cueIndex);
        break;
      default:
        break;
    }
  }

  update(nowSec: number, songPosSec: number): void {
    const dt = this.#lastNowSec === null ? 0 : Math.max(0, nowSec - this.#lastNowSec);
    this.#lastNowSec = nowSec;

    this.#updateCues(dt, songPosSec);
    this.#updateStars(dt);
    this.#cameraRig.update(dt);
    this.#hud.update(nowSec, this.#stats);

    this.#gameRenderer.renderer.render(this.#threeScene, this.#cameraRig.camera);
  }

  resize(width: number, height: number, dpr: number): void {
    this.#gameRenderer.resize(width, height, dpr);
    this.#cameraRig.resize(width, height);
  }

  dispose(): void {
    this.#hud.dispose();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#gameRenderer.dispose();
  }

  // ---- キュー演出 ----------------------------------------------------

  #spawnCue(cueIndex: number, kind: number, targetSec: number): void {
    const slot = findFreeSlot(this.#cueSlots);
    if (slot === -1) {
      return; // プール枯渇（想定外の高密度譜面）: このキューは表示演出を諦める
    }
    const entry = this.#cuePool.acquire();
    entry.cueIndex = cueIndex;
    entry.kind = kind;
    entry.targetSec = targetSec;
    entry.phase = 'approach';
    entry.phaseTimeSec = 0;
    entry.baseScale = kind === 1 ? BAR_HEAD_SCALE : 1;
    entry.material.color.setHex(COLOR_CUE_NEUTRAL);
    entry.mesh.visible = true;
    entry.mesh.position.set(SPAWN_POS.x, SPAWN_POS.y, SPAWN_POS.z);
    entry.mesh.rotation.set(0, 0, 0);
    entry.mesh.scale.setScalar(entry.baseScale);
    this.#cueSlots[slot] = entry;
  }

  #judgeCue(cueIndex: number, judgment: number, errorMs: number): void {
    // 統計は演出スロットの有無に依存させない（プール枯渇でスポーンを諦めたキューでも
    // HUD の集計はリザルト側の core 統計と一致させる）。
    if (judgment === 0) {
      this.#stats.recordJust(errorMs);
    } else {
      // judgment === 1 (Safe)。仕様上 Judged は Just/Safe のみ発火する。
      this.#stats.recordSafe(errorMs);
    }

    const slot = findSlotByCueIndex(this.#cueSlots, cueIndex);
    if (slot === -1) {
      return;
    }
    const entry = this.#cueSlots[slot];
    if (entry === null || entry === undefined) {
      return;
    }
    // 判定演出はヒット期待点（リング）から再生する。CueApproach と同一 tick で判定された
    // 場合、まだ補間前でスポーン地点(上空)にいるため、ここでスナップしておく。
    entry.mesh.position.set(RING_POS.x, RING_POS.y, RING_POS.z);
    if (judgment === 0) {
      entry.phase = 'just';
      entry.phaseTimeSec = 0;
      entry.material.color.setHex(COLOR_CUE_JUST);
      this.#cameraRig.shake(SHAKE_JUST_STRENGTH);
      this.#spawnStar(RING_POS.x, RING_POS.y, RING_POS.z);
    } else {
      entry.phase = 'safe';
      entry.phaseTimeSec = 0;
      entry.material.color.setHex(COLOR_CUE_SAFE);
    }
  }

  #missCue(cueIndex: number): void {
    // 統計は演出スロットの有無に依存させない。
    this.#stats.recordMiss();

    const slot = findSlotByCueIndex(this.#cueSlots, cueIndex);
    if (slot === -1) {
      return;
    }
    const entry = this.#cueSlots[slot];
    if (entry === null || entry === undefined) {
      return;
    }
    entry.phase = 'miss';
    entry.phaseTimeSec = 0;
    entry.material.color.setHex(COLOR_CUE_MISS);
  }

  #spawnStar(x: number, y: number, z: number): void {
    const slot = findFreeSlot(this.#starSlots);
    if (slot === -1) {
      return;
    }
    const entry = this.#starPool.acquire();
    entry.timeSec = 0;
    entry.mesh.position.set(x, y, z);
    entry.mesh.scale.setScalar(0.05);
    entry.mesh.rotation.z = 0;
    entry.material.opacity = 1;
    entry.mesh.visible = true;
    this.#starSlots[slot] = entry;
  }

  #updateCues(dt: number, songPosSec: number): void {
    for (let i = 0; i < this.#cueSlots.length; i++) {
      const entry = this.#cueSlots[i];
      if (entry === null || entry === undefined) {
        continue;
      }
      switch (entry.phase) {
        case 'approach':
          this.#advanceApproach(entry, songPosSec);
          break;
        case 'just':
          this.#advanceJust(entry, i, dt);
          break;
        case 'safe':
          this.#advanceSafe(entry, i, dt);
          break;
        case 'miss':
          this.#advanceMiss(entry, i, dt);
          break;
      }
    }
  }

  #advanceApproach(entry: CueEntry, songPosSec: number): void {
    const t = clamp((entry.targetSec - songPosSec) / APPROACH_SEC, 0, 1);
    const x = lerp(RING_POS.x, SPAWN_POS.x, t);
    const y = lerp(RING_POS.y, SPAWN_POS.y, t) + Math.sin(t * Math.PI) * ARC_HEIGHT;
    const z = lerp(RING_POS.z, SPAWN_POS.z, t);
    entry.mesh.position.set(x, y, z);
    entry.mesh.rotation.y = songPosSec * 2;
  }

  #advanceJust(entry: CueEntry, slot: number, dt: number): void {
    entry.phaseTimeSec += dt;
    const t = clamp(entry.phaseTimeSec / JUST_DURATION_SEC, 0, 1);
    const pop = 1 + 0.4 * Math.sin(t * Math.PI);
    const shrink = 1 - easeOutQuad(t);
    entry.mesh.scale.setScalar(entry.baseScale * pop * shrink);
    if (entry.phaseTimeSec >= JUST_DURATION_SEC) {
      this.#releaseCue(slot);
    }
  }

  #advanceSafe(entry: CueEntry, slot: number, dt: number): void {
    entry.phaseTimeSec += dt;
    const t = clamp(entry.phaseTimeSec / SAFE_DURATION_SEC, 0, 1);
    const wobble = Math.sin(t * Math.PI * 4) * (1 - t) * 0.6;
    entry.mesh.position.set(
      RING_POS.x + wobble,
      RING_POS.y - easeOutQuad(t) * 2.5,
      RING_POS.z + easeOutQuad(t) * 2,
    );
    entry.mesh.rotation.z = wobble;
    entry.mesh.scale.setScalar(entry.baseScale * (1 - 0.3 * t));
    if (entry.phaseTimeSec >= SAFE_DURATION_SEC) {
      this.#releaseCue(slot);
    }
  }

  #advanceMiss(entry: CueEntry, slot: number, dt: number): void {
    entry.phaseTimeSec += dt;
    const t = clamp(entry.phaseTimeSec / MISS_DURATION_SEC, 0, 1);
    entry.mesh.position.set(RING_POS.x, RING_POS.y - t * t * 8, RING_POS.z);
    entry.mesh.rotation.set(t * 5, 0, t * 3);
    if (entry.phaseTimeSec >= MISS_DURATION_SEC) {
      this.#releaseCue(slot);
    }
  }

  #releaseCue(slot: number): void {
    const entry = this.#cueSlots[slot];
    if (entry === null || entry === undefined) {
      return;
    }
    entry.mesh.visible = false;
    this.#cueSlots[slot] = null;
    this.#cuePool.release(entry);
  }

  #updateStars(dt: number): void {
    for (let i = 0; i < this.#starSlots.length; i++) {
      const entry = this.#starSlots[i];
      if (entry === null || entry === undefined) {
        continue;
      }
      entry.timeSec += dt;
      const t = clamp(entry.timeSec / STAR_DURATION_SEC, 0, 1);
      entry.mesh.scale.setScalar(lerp(0.2, 1.6, easeOutQuad(t)));
      entry.material.opacity = 1 - t;
      entry.mesh.rotation.z = t * 3;
      if (t >= 1) {
        entry.mesh.visible = false;
        this.#starSlots[i] = null;
        this.#starPool.release(entry);
      }
    }
  }
}
