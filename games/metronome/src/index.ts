// games/metronome: コンテンツコストゼロの dev 用ミニゲーム（M0-SPEC §7）。
// engine/scene-kit の疎結合契約を実証する 2 本目のモジュール。

import {
  CalibrationStore,
  GameLoop,
  InputQueue,
  RenderClient,
  createSession,
  decodeEvents,
  hapticTap,
  initWasm,
  loadBinary,
  renderNoteBuffer,
} from '@rhythm/engine';
import type { EngineEvent, Minigame, MinigameContext, MinigameScene, SessionHandle, VerbSpec } from '@rhythm/engine';

// `?url` サフィックス付きアセット import は assets.d.ts のアンビエント宣言で型解決される。
import midiUrl from '../../../charts/metronome.mid?url';
import sf2Url from '../../../charts/dev.sf2?url';
import overlay from '../../../charts/metronome.json';

import { MetronomeScene } from './scene';

/** 曲サンプルレートの既定値（AudioContext から取得できない場合のフォールバック）。 */
const SAMPLE_RATE_FALLBACK = 48000;
/** playSong の先行予約秒（100〜200ms 先行予約の中間値）。 */
const SONG_LEAD_SEC = 0.15;
/** M0-SPEC §7: approachSec = 1.0（2 拍 @120BPM）。scene.ts の APPROACH_SEC と一致させること。 */
const APPROACH_SEC = 1.0;
const JUST_MS = 45;
const SAFE_MS = 100;

interface Calibration {
  inputOffsetMs: number;
  videoOffsetMs: number;
}

function readCalibration(): Calibration {
  // Cookie ブロック環境では localStorage へのアクセス自体が throw するため try で包む。
  try {
    if (typeof localStorage !== 'undefined') {
      return new CalibrationStore(localStorage).get();
    }
  } catch {
    // 既定値フォールバックへ。
  }
  return { inputOffsetMs: 0, videoOffsetMs: 0 };
}

/** `Minigame` 契約の metronome 実装。 */
class MetronomeGame implements Minigame {
  readonly id = 'metronome';
  readonly verbs: VerbSpec[] = [{ id: 0, name: 'tap' }];

  #ctx: MinigameContext | null = null;
  #session: SessionHandle | null = null;
  #songBuffer: AudioBuffer | null = null;
  #tapBuffer: AudioBuffer | null = null;
  #scene: MetronomeScene | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #inputQueue: InputQueue | null = null;
  #loop: GameLoop | null = null;
  #startedAt = 0;
  #videoOffsetSec = 0;

  /** decodeEvents の出力先。フレーム間で再利用する（割り当てゼロ）。 */
  readonly #decodedEvents: EngineEvent[] = [];

  async load(ctx: MinigameContext, onProgress: (r: number) => void): Promise<void> {
    this.#ctx = ctx;
    onProgress(0);

    const [midi, sf2] = await Promise.all([loadBinary(midiUrl), loadBinary(sf2Url)]);

    const sampleRate = ctx.audio.context.sampleRate || SAMPLE_RATE_FALLBACK;
    const renderClient = new RenderClient();
    const rendered = await renderClient.renderSong(
      { midi, sf2, sampleRate, excludeTrack: overlay.cueTrack },
      (ratio) => onProgress(ratio * 0.8),
    );
    onProgress(0.8);

    this.#songBuffer = ctx.audio.toAudioBuffer(rendered.sampleRate, rendered.left, rendered.right);

    await initWasm();
    onProgress(0.9);

    const tapSpec = overlay.sfx.tap;
    const tapRendered = renderNoteBuffer(
      sf2,
      tapSpec.percussion,
      tapSpec.preset,
      tapSpec.key,
      tapSpec.velocity,
      tapSpec.durationSec,
      sampleRate,
    );
    this.#tapBuffer = ctx.audio.toAudioBuffer(
      tapRendered.sampleRate,
      tapRendered.left,
      tapRendered.right,
    );
    onProgress(0.95);

    this.#session = createSession(midi, JSON.stringify(overlay), {
      justMs: JUST_MS,
      safeMs: SAFE_MS,
      approachSec: APPROACH_SEC,
    });

    this.#videoOffsetSec = readCalibration().videoOffsetMs / 1000;

    onProgress(1);
  }

  createScene(canvas: HTMLCanvasElement): MinigameScene {
    const scene = new MetronomeScene(canvas);
    this.#scene = scene;
    this.#canvas = canvas;
    return scene;
  }

  start(): void {
    const ctx = this.#ctx;
    const songBuffer = this.#songBuffer;
    const tapBuffer = this.#tapBuffer;
    const canvas = this.#canvas;
    if (ctx === null || songBuffer === null || tapBuffer === null || canvas === null) {
      throw new Error('metronomeGame.start(): load() と createScene() を先に呼ぶこと');
    }

    const inputQueue = new InputQueue(ctx.clock, {
      inputOffsetMs: readCalibration().inputOffsetMs,
      onTap: () => {
        ctx.audio.playSfx(tapBuffer);
        // Android 等 Vibration API 対応環境の触覚。iOS はシェル側の透明スイッチ
        // （PlayHapticLayer）がタップ時にネイティブハプティックを鳴らす。
        hapticTap();
      },
    });
    // pointerdown / keydown とも window で受ける。iOS ではシェルのハプティクスレイヤ
    // （透明スイッチ）が canvas を覆うため、canvas 直付けだとタップが届かない。
    // バブリング後の window で拾えばオーバレイ越しでも同一 timeStamp で取得できる。
    inputQueue.attach(window);
    this.#inputQueue = inputQueue;

    const { startedAt } = ctx.audio.playSong(songBuffer, ctx.clock.now() + SONG_LEAD_SEC);
    this.#startedAt = startedAt;

    const loop = new GameLoop();
    this.#loop = loop;
    loop.start(() => this.#tick());
  }

  stop(): void {
    this.#loop?.stop();
    this.#inputQueue?.detach();
    this.#loop = null;
    this.#inputQueue = null;
  }

  #tick(): void {
    const ctx = this.#ctx;
    const session = this.#session;
    const scene = this.#scene;
    const inputQueue = this.#inputQueue;
    const loop = this.#loop;
    if (ctx === null || session === null || scene === null || inputQueue === null || loop === null) {
      return;
    }

    const now = ctx.clock.now();
    const songPos = now - this.#startedAt;

    // InputQueue.drain() は audio 絶対時刻を返すため、曲時刻（songPos 基準）へ変換してから
    // tick() へ渡す。再利用ビューをその場でミューテートするため割り当ては発生しない。
    const inputs = inputQueue.drain();
    for (let i = 0; i < inputs.length; i += 2) {
      inputs[i] = (inputs[i] ?? 0) - this.#startedAt;
    }

    const flat = session.tick(songPos, inputs);
    const count = decodeEvents(flat, this.#decodedEvents);
    for (let i = 0; i < count; i++) {
      const ev = this.#decodedEvents[i];
      if (ev !== undefined) {
        scene.handleEvent(ev);
      }
    }

    scene.setLoopMetrics(loop.metrics.fps, loop.metrics.tickMs);
    // videoOffsetSec は表示補間にのみ加算する（判定用の songPos には加算しない）。
    scene.update(now, songPos + this.#videoOffsetSec);

    if (session.finished(songPos)) {
      this.stop();
      ctx.onFinished(session.statsJson());
    }
  }
}

const metronomeGame: Minigame = new MetronomeGame();
export default metronomeGame;
