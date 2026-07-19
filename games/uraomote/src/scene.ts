// ウラオモテゲームの 3D シーン。ローポリ・トゥーン、縦構図。metronome の scene.ts と同じ
// プール・スロット・approach 補間・judge/miss 演出・dispose 規律を踏襲する。
// 独自要素: 表拍(kind=0)/裏拍(kind=1) のセクション反転。CueApproach の kind が現在モードと
// 異なったら (a) DOM バナー「ウラ!/オモテ!」表示 (b) 背景・地面・リング色の 0.4 秒補間遷移
// (c) 中央奥のシンボルコインの X 軸 π 回転（累積）で切り替わりを予告する。
// リングは BPM116 の表拍（ウラ中は 0.5 拍ずれた裏拍）のタイミングで脈動する。
// 全オブジェクトはプール済みで、フレーム内 new を行わない。

import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  Scene,
  TorusGeometry,
} from "three";
import {
  ObjectPool,
  PortraitCameraRig,
  addOutline,
  createGameRenderer,
  createToonMaterial,
} from "@rhythm/scene-kit";
import type { GameRenderer } from "@rhythm/scene-kit";
import type { EngineEvent, MinigameScene } from "@rhythm/engine";

import { DebugHud } from "./hud";
import { JudgeStatsAccumulator } from "./judge-stats";
import { clamp, easeOutQuad, lerp } from "./math-utils";
import { createStarGeometry } from "./star-geometry";
import { TutorialGuide } from "./tutorial";

/** createSession() の approachSec と一致させること（1.55 秒 ≒ 3 拍 @116BPM）。 */
const APPROACH_SEC = 1.55;
/** 1 拍の長さ（BPM116）。リング脈動の位相計算に使う。 */
const BEAT_SEC = 60 / 116;

const SPAWN_POS = { x: 0, y: 14, z: -28 } as const;
const RING_POS = { x: 0, y: 1.4, z: 5 } as const;
/** シンボルコイン（表裏の反転を可視化する円盤）の位置。中央奥。 */
const COIN_POS = { x: 0, y: 6.5, z: -12 } as const;
const CAMERA_POSITION: [number, number, number] = [0, 6, 13];
const CAMERA_LOOK_AT: [number, number, number] = [0, 3, -6];

const ARC_HEIGHT = 3.2;

const JUST_DURATION_SEC = 0.45;
const SAFE_DURATION_SEC = 0.5;
const MISS_DURATION_SEC = 0.6;
const STAR_DURATION_SEC = 0.4;
/** モード反転時の配色補間の長さ。 */
const COLOR_TRANSITION_SEC = 0.4;
/** シンボルコインの半回転の長さ（easeOutQuad）。 */
const COIN_FLIP_DURATION_SEC = 0.5;
/** バナー「ウラ!/オモテ!」の表示時間。経過後は CSS transition でフェードアウトする。 */
const BANNER_DURATION_SEC = 0.9;

const CUE_CAPACITY = 24;
const STAR_CAPACITY = 8;

const SHAKE_JUST_STRENGTH = 0.35;

/** リング脈動: 拍中心から ± この拍距離の範囲で scale 1→1.12→1。 */
const RING_PULSE_WIDTH_BEATS = 0.25;
const RING_PULSE_AMOUNT = 0.12;

// 配色（オモテ=暖色 / ウラ=寒色）。モード反転時に COLOR_TRANSITION_SEC で補間遷移する。
const COLOR_OMOTE_BACKGROUND = 0x241a2f;
const COLOR_OMOTE_GROUND = 0x3a2a1c;
const COLOR_OMOTE_RING = 0xffd166;
const COLOR_URA_BACKGROUND = 0x0d1626;
const COLOR_URA_GROUND = 0x16283a;
const COLOR_URA_RING = 0x5ac8ff;

const COLOR_CUE_OMOTE = 0xffc94a;
const COLOR_CUE_URA = 0x55c8ff;
const COLOR_CUE_JUST = 0xffd54a;
const COLOR_CUE_SAFE = 0x4a90ff;
const COLOR_CUE_MISS = 0xff4a4a;
const COLOR_STAR = 0xffe066;
const COLOR_OUTLINE = 0x101014;

const COLOR_COIN_FRONT = 0xffc94a;
const COLOR_COIN_BACK = 0x3b82d0;
const COLOR_COIN_SIDE = 0x2a2233;

const BANNER_COLOR_OMOTE = "#ffc94a";
const BANNER_COLOR_URA = "#55c8ff";

/** コインの初期 X 回転。円柱を 90 度起こして上面/下面（表裏）が画面を向くようにする。 */
const COIN_BASE_ROT_X = Math.PI / 2;

const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 844;

type Mode = "omote" | "ura";

type CuePhase = "approach" | "just" | "safe" | "miss";

interface CueEntry {
  readonly mesh: Mesh;
  /** インバーテッドハル輪郭。kind 切替時に本体とジオメトリを揃えて差し替える。 */
  readonly outline: Mesh;
  readonly material: MeshToonMaterial;
  cueIndex: number;
  kind: number;
  targetSec: number;
  phase: CuePhase;
  phaseTimeSec: number;
}

interface StarEntry {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  timeSec: number;
}

interface Disposable {
  dispose(): void;
}

/** オモテ拍（kind=0）キュー玉のジオメトリ（ローポリ、一度だけ生成して共有）。 */
const CUE_OMOTE_GEOMETRY = new IcosahedronGeometry(0.6, 0);
/** ウラ拍（kind=1）キュー玉のジオメトリ。 */
const CUE_URA_GEOMETRY = new OctahedronGeometry(0.7, 0);
/** 全 Just 演出が共有する星形ジオメトリ。 */
const STAR_GEOMETRY = createStarGeometry(0.9, 0.4, 5);

/**
 * モード反転バナー「ウラ!/オモテ!」。DebugHud と同様に DOM オーバレイへ直接描画する
 * （React 不使用）。トランジションは CSS に任せ、表示時間だけ update() の dt で管理する。
 */
class FlipBanner {
  readonly #el: HTMLDivElement;
  #visibleSec = Number.POSITIVE_INFINITY;

  constructor(parent: HTMLElement = document.body) {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.top = "45%";
    el.style.left = "50%";
    el.style.transform = "translate(-50%, -50%) scale(0.4)";
    el.style.fontSize = "12vw";
    el.style.fontWeight = "900";
    el.style.fontFamily = "system-ui, sans-serif";
    el.style.whiteSpace = "nowrap";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "1001";
    // 縁取り + 影の二重化でどちらの背景色でも視認できるようにする。
    el.style.setProperty("-webkit-text-stroke", "0.06em rgba(16,16,20,0.9)");
    el.style.textShadow = "0 0.06em 0.2em rgba(0,0,0,0.8)";
    parent.appendChild(el);
    this.#el = el;
  }

  /** バナーを表示する。scale(0.4)→scale(1) と opacity の CSS transition で飛び出させる。 */
  show(text: string, color: string): void {
    const el = this.#el;
    el.textContent = text;
    el.style.color = color;
    // 表示中の再表示でも頭から再生されるよう、transition を切って初期状態へ戻し、
    // 強制リフローで確定させてから遷移を開始する。
    el.style.transition = "none";
    el.style.transform = "translate(-50%, -50%) scale(0.4)";
    el.style.opacity = "0";
    el.getBoundingClientRect(); // 強制リフロー（transition なしの初期状態を確定させる）
    el.style.transition = "transform 0.25s ease-out, opacity 0.15s ease-out";
    el.style.transform = "translate(-50%, -50%) scale(1)";
    el.style.opacity = "1";
    this.#visibleSec = 0;
  }

  /** 表示経過を進め、BANNER_DURATION_SEC を超えたらフェードアウトへ移す。 */
  update(dt: number): void {
    if (this.#visibleSec >= BANNER_DURATION_SEC) {
      return;
    }
    this.#visibleSec += dt;
    if (this.#visibleSec >= BANNER_DURATION_SEC) {
      this.#el.style.opacity = "0";
    }
  }

  dispose(): void {
    this.#el.remove();
  }
}

function createCueEntry(threeScene: Scene, disposables: Disposable[]): CueEntry {
  const material = createToonMaterial(COLOR_CUE_OMOTE);
  disposables.push(material);
  const mesh = new Mesh(CUE_OMOTE_GEOMETRY, material);
  const outline = addOutline(mesh, 1.06, COLOR_OUTLINE);
  // 輪郭マテリアルは addOutline が新規生成して所有する（ジオメトリは共有）ため破棄登録する。
  disposables.push(outline.material as Disposable);
  mesh.visible = false;
  threeScene.add(mesh);
  return {
    mesh,
    outline,
    material,
    cueIndex: -1,
    kind: 0,
    targetSec: 0,
    phase: "approach",
    phaseTimeSec: 0,
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

/** ウラオモテゲームの MinigameScene 実装。index.ts から createScene() 経由で生成される。 */
export class UraomoteScene implements MinigameScene {
  readonly #gameRenderer: GameRenderer;
  readonly #threeScene: Scene;
  readonly #cameraRig: PortraitCameraRig;
  readonly #hud: DebugHud;
  readonly #banner: FlipBanner;
  readonly #tutorial: TutorialGuide;
  readonly #stats = new JudgeStatsAccumulator();
  readonly #disposables: Disposable[] = [];

  readonly #cuePool = new ObjectPool<CueEntry>();
  readonly #cueSlots: Array<CueEntry | null> = Array.from({ length: CUE_CAPACITY }, () => null);

  readonly #starPool = new ObjectPool<StarEntry>();
  readonly #starSlots: Array<StarEntry | null> = Array.from({ length: STAR_CAPACITY }, () => null);

  #lastNowSec: number | null = null;

  // ---- モード反転の状態 ----------------------------------------------
  #mode: Mode = "omote";
  /** Scene.background として共有する Color。補間はこのインスタンスをミューテートする。 */
  readonly #bgColor = new Color(COLOR_OMOTE_BACKGROUND);
  readonly #bgFrom = new Color(COLOR_OMOTE_BACKGROUND);
  readonly #bgTo = new Color(COLOR_OMOTE_BACKGROUND);
  readonly #groundFrom = new Color(COLOR_OMOTE_GROUND);
  readonly #groundTo = new Color(COLOR_OMOTE_GROUND);
  readonly #ringFrom = new Color(COLOR_OMOTE_RING);
  readonly #ringTo = new Color(COLOR_OMOTE_RING);
  /** 完了値で初期化しておく（起動直後は遷移なし）。 */
  #colorTransitionSec = COLOR_TRANSITION_SEC;

  readonly #groundMaterial: MeshToonMaterial;
  readonly #ringMaterial: MeshToonMaterial;
  readonly #ring: Mesh;
  readonly #coin: Mesh;

  #coinFlipFromX = COIN_BASE_ROT_X;
  /** 累積回転の目標角。反転のたびに π ずつ増える。 */
  #coinRotTargetX = COIN_BASE_ROT_X;
  #coinFlipTimeSec = COIN_FLIP_DURATION_SEC;

  constructor(canvas: HTMLCanvasElement) {
    this.#gameRenderer = createGameRenderer(canvas);
    this.#threeScene = new Scene();
    this.#threeScene.background = this.#bgColor;

    const width = canvas.clientWidth > 0 ? canvas.clientWidth : DEFAULT_WIDTH;
    const height = canvas.clientHeight > 0 ? canvas.clientHeight : DEFAULT_HEIGHT;
    this.#cameraRig = new PortraitCameraRig({
      fov: 55,
      aspect: width / height,
      position: CAMERA_POSITION,
      lookAt: CAMERA_LOOK_AT,
    });
    const dpr = typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    this.#gameRenderer.resize(width, height, dpr);

    this.#threeScene.add(new HemisphereLight(0xddeeff, 0x223322, 0.95));
    const dirLight = new DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(5, 10, 7);
    this.#threeScene.add(dirLight);

    const groundGeometry = new CircleGeometry(30, 24);
    const groundMaterial = createToonMaterial(COLOR_OMOTE_GROUND);
    this.#disposables.push(groundGeometry, groundMaterial);
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    this.#threeScene.add(ground);
    this.#groundMaterial = groundMaterial;

    const ringGeometry = new TorusGeometry(1.6, 0.22, 8, 24);
    const ringMaterial = createToonMaterial(COLOR_OMOTE_RING);
    this.#disposables.push(ringGeometry, ringMaterial);
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.position.set(RING_POS.x, RING_POS.y, RING_POS.z);
    const ringOutline = addOutline(ring, 1.05, COLOR_OUTLINE);
    this.#disposables.push(ringOutline.material as Disposable);
    this.#threeScene.add(ring);
    this.#ringMaterial = ringMaterial;
    this.#ring = ring;

    // シンボルコイン: 表(金)/裏(青)の円盤。モード反転のたびに X 軸へ π 回転して裏返る。
    // CylinderGeometry のマテリアルグループ順は [側面, 上面キャップ, 下面キャップ]。
    // X 軸 +90 度回転で上面(+Y)が +Z（カメラ側）を向くため、上面=表 / 下面=裏になる。
    const coinGeometry = new CylinderGeometry(2.2, 2.2, 0.3, 24);
    const coinSideMaterial = createToonMaterial(COLOR_COIN_SIDE);
    const coinFrontMaterial = createToonMaterial(COLOR_COIN_FRONT);
    const coinBackMaterial = createToonMaterial(COLOR_COIN_BACK);
    this.#disposables.push(coinGeometry, coinSideMaterial, coinFrontMaterial, coinBackMaterial);
    const coin = new Mesh(coinGeometry, [coinSideMaterial, coinFrontMaterial, coinBackMaterial]);
    coin.position.set(COIN_POS.x, COIN_POS.y, COIN_POS.z);
    coin.rotation.x = COIN_BASE_ROT_X;
    const coinOutline = addOutline(coin, 1.04, COLOR_OUTLINE);
    this.#disposables.push(coinOutline.material as Disposable);
    this.#threeScene.add(coin);
    this.#coin = coin;

    this.#cuePool.prealloc(CUE_CAPACITY, () => createCueEntry(this.#threeScene, this.#disposables));
    this.#starPool.prealloc(STAR_CAPACITY, () =>
      createStarEntry(this.#threeScene, this.#disposables),
    );

    this.#hud = new DebugHud();
    this.#banner = new FlipBanner();
    this.#tutorial = new TutorialGuide();
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

    this.#updateModeColors(dt);
    this.#updateCoinFlip(dt);
    this.#updateRingPulse(songPosSec);
    this.#updateCues(dt, songPosSec);
    this.#updateStars(dt);
    this.#banner.update(dt);
    this.#tutorial.update(songPosSec);
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
    this.#banner.dispose();
    this.#tutorial.dispose();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#gameRenderer.dispose();
  }

  // ---- モード反転 ----------------------------------------------------

  /** kind に対応するモードへ反転する。CueApproach が現在モードと異なる kind を告げたときに呼ぶ。 */
  #startFlip(nextMode: Mode): void {
    this.#mode = nextMode;

    // (a) バナー: 切替先の名前を叫ぶ。
    if (nextMode === "ura") {
      this.#banner.show("ウラ!", BANNER_COLOR_URA);
    } else {
      this.#banner.show("オモテ!", BANNER_COLOR_OMOTE);
    }

    // (b) 配色: 現在色（遷移途中でも可）から切替先パレットへ補間開始。
    this.#bgFrom.copy(this.#bgColor);
    this.#groundFrom.copy(this.#groundMaterial.color);
    this.#ringFrom.copy(this.#ringMaterial.color);
    if (nextMode === "ura") {
      this.#bgTo.setHex(COLOR_URA_BACKGROUND);
      this.#groundTo.setHex(COLOR_URA_GROUND);
      this.#ringTo.setHex(COLOR_URA_RING);
    } else {
      this.#bgTo.setHex(COLOR_OMOTE_BACKGROUND);
      this.#groundTo.setHex(COLOR_OMOTE_GROUND);
      this.#ringTo.setHex(COLOR_OMOTE_RING);
    }
    this.#colorTransitionSec = 0;

    // (c) コイン: X 軸へ π 追加回転（累積）。フリップ途中の再反転も現在角から滑らかに繋ぐ。
    this.#coinFlipFromX = this.#coin.rotation.x;
    this.#coinRotTargetX += Math.PI;
    this.#coinFlipTimeSec = 0;
  }

  #updateModeColors(dt: number): void {
    if (this.#colorTransitionSec >= COLOR_TRANSITION_SEC) {
      return;
    }
    this.#colorTransitionSec = Math.min(this.#colorTransitionSec + dt, COLOR_TRANSITION_SEC);
    const t = this.#colorTransitionSec / COLOR_TRANSITION_SEC;
    this.#bgColor.lerpColors(this.#bgFrom, this.#bgTo, t);
    this.#groundMaterial.color.lerpColors(this.#groundFrom, this.#groundTo, t);
    this.#ringMaterial.color.lerpColors(this.#ringFrom, this.#ringTo, t);
  }

  #updateCoinFlip(dt: number): void {
    if (this.#coinFlipTimeSec >= COIN_FLIP_DURATION_SEC) {
      return;
    }
    this.#coinFlipTimeSec = Math.min(this.#coinFlipTimeSec + dt, COIN_FLIP_DURATION_SEC);
    const t = easeOutQuad(this.#coinFlipTimeSec / COIN_FLIP_DURATION_SEC);
    this.#coin.rotation.x = lerp(this.#coinFlipFromX, this.#coinRotTargetX, t);
  }

  /** オモテ中は表拍・ウラ中は裏拍（0.5 拍ずらし）のタイミングでリングを 1→1.12→1 に脈動させる。 */
  #updateRingPulse(songPosSec: number): void {
    const beats = songPosSec / BEAT_SEC + (this.#mode === "ura" ? 0.5 : 0);
    const phase = beats - Math.floor(beats);
    const distBeats = Math.min(phase, 1 - phase);
    const k = clamp(1 - distBeats / RING_PULSE_WIDTH_BEATS, 0, 1);
    this.#ring.scale.setScalar(1 + RING_PULSE_AMOUNT * easeOutQuad(k));
  }

  // ---- キュー演出 ----------------------------------------------------

  #spawnCue(cueIndex: number, kind: number, targetSec: number): void {
    // 現在モードと異なる kind の接近はセクション切替の合図。反転はスロットの有無に依存させない
    // （プール枯渇でスポーンを諦めてもモード状態は譜面と同期し続ける）。
    const nextMode: Mode = kind === 1 ? "ura" : "omote";
    if (nextMode !== this.#mode) {
      this.#startFlip(nextMode);
    }

    const slot = findFreeSlot(this.#cueSlots);
    if (slot === -1) {
      return; // プール枯渇（想定外の高密度譜面）: このキューは表示演出を諦める
    }
    const entry = this.#cuePool.acquire();
    entry.cueIndex = cueIndex;
    entry.kind = kind;
    entry.targetSec = targetSec;
    entry.phase = "approach";
    entry.phaseTimeSec = 0;
    // kind ごとに形状・ベース色を切り替える（ジオメトリは共有インスタンスの差し替えのみ）。
    const geometry = kind === 1 ? CUE_URA_GEOMETRY : CUE_OMOTE_GEOMETRY;
    entry.mesh.geometry = geometry;
    entry.outline.geometry = geometry;
    entry.material.color.setHex(kind === 1 ? COLOR_CUE_URA : COLOR_CUE_OMOTE);
    entry.mesh.visible = true;
    entry.mesh.position.set(SPAWN_POS.x, SPAWN_POS.y, SPAWN_POS.z);
    entry.mesh.rotation.set(0, 0, 0);
    entry.mesh.scale.setScalar(1);
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
      entry.phase = "just";
      entry.phaseTimeSec = 0;
      entry.material.color.setHex(COLOR_CUE_JUST);
      this.#cameraRig.shake(SHAKE_JUST_STRENGTH);
      this.#spawnStar(RING_POS.x, RING_POS.y, RING_POS.z);
    } else {
      entry.phase = "safe";
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
    entry.phase = "miss";
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
        case "approach":
          this.#advanceApproach(entry, songPosSec);
          break;
        case "just":
          this.#advanceJust(entry, i, dt);
          break;
        case "safe":
          this.#advanceSafe(entry, i, dt);
          break;
        case "miss":
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
    entry.mesh.scale.setScalar(pop * shrink);
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
    entry.mesh.scale.setScalar(1 - 0.3 * t);
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
