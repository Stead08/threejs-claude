// AudioEngine: Web Audio 再生。iOS unlock / サイレントスイッチ対策 / 可視性連動 suspend を担う。

// iOS サイレントスイッチ対策用の無音 wav（data URI）。
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';

/** visibilitychange 監視に必要な最小の document 抽象（注入式）。 */
export interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface AudioEngineOptions {
  /** AudioContext（未指定なら遅延生成せず即時生成）。 */
  context?: AudioContext;
  /** 無音ループ用 <audio> 要素のファクトリ（既定は新規 Audio(SILENT_WAV)）。 */
  audioElementFactory?: () => HTMLAudioElement;
}

/** Web Audio 再生エンジン。 */
export class AudioEngine {
  readonly #ctx: AudioContext;
  readonly #createAudioElement: () => HTMLAudioElement;
  #silentAudio: HTMLAudioElement | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.#ctx = options.context ?? new AudioContext();
    this.#createAudioElement = options.audioElementFactory ?? (() => new Audio(SILENT_WAV));
  }

  /** 内部 AudioContext。AudioClock 構築などに使う。 */
  get context(): AudioContext {
    return this.#ctx;
  }

  /**
   * ユーザジェスチャ内で呼ぶ。resume + 無音バッファ 1 発 + 無音 <audio loop> 再生開始で
   * iOS のオーディオアンロックとサイレントスイッチ対策を行う。
   */
  async unlock(): Promise<void> {
    if (this.#ctx.state === 'suspended') {
      await this.#ctx.resume();
    }
    // 無音バッファを 1 発鳴らしてアンロックを確実にする。
    const buffer = this.#ctx.createBuffer(1, 1, this.#ctx.sampleRate);
    const source = this.#ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#ctx.destination);
    source.start(0);
    // 無音 <audio loop> をメディア再生カテゴリへ切り替えるために再生する。
    if (this.#silentAudio === null) {
      this.#silentAudio = this.#createAudioElement();
      this.#silentAudio.loop = true;
    }
    try {
      await this.#silentAudio.play();
    } catch {
      // 再生失敗（自動再生ブロック等）は致命ではないので無視する。
    }
  }

  /** レンダ済み PCM（左右）を AudioBuffer 化する。 */
  toAudioBuffer(sampleRate: number, left: Float32Array, right: Float32Array): AudioBuffer {
    const length = Math.min(left.length, right.length);
    const buffer = this.#ctx.createBuffer(2, length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
  }

  /**
   * 曲を先行予約再生する。whenSec は呼び側が clock.now() + 0.15 程度で渡す。
   * songPos = clock.now() - startedAt で曲位置を求められる。
   */
  playSong(buffer: AudioBuffer, whenSec: number): { startedAt: number } {
    const source = this.#ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#ctx.destination);
    source.start(whenSec);
    return { startedAt: whenSec };
  }

  /** SFX を即時再生する。 */
  playSfx(buffer: AudioBuffer): void {
    const source = this.#ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#ctx.destination);
    source.start();
  }

  /** AudioContext を suspend する。 */
  async suspend(): Promise<void> {
    if (this.#ctx.state === 'running') {
      await this.#ctx.suspend();
    }
  }

  /** AudioContext を resume する。 */
  async resume(): Promise<void> {
    if (this.#ctx.state === 'suspended') {
      await this.#ctx.resume();
    }
  }

  /**
   * visibilitychange で自動 suspend/resume するリスナを登録する。
   * 返り値は登録解除関数。document 相当は注入可能。
   */
  attachVisibilityAutoSuspend(doc: VisibilityDocument): () => void {
    const handler = (): void => {
      if (doc.hidden) {
        void this.suspend();
      } else {
        void this.resume();
      }
    };
    doc.addEventListener('visibilitychange', handler);
    return (): void => {
      doc.removeEventListener('visibilitychange', handler);
    };
  }
}
