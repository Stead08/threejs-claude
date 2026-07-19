# M0 実装仕様（実装契約） — メトロノーム縦切り

docs/PLAN.md（v1.0）の M0 を実装するための**確定契約**。各パッケージ/クレートの実装者は本仕様の API・プロトコル・依存関係に**厳密に従う**こと。仕様との乖離が必要になった場合は実装を止めず、乖離内容を成果物レポートに明記する。

- 対象: pnpm/cargo workspace scaffolding、`crates/{core,synth,wasm,tools}`、`packages/{engine,scene-kit,shell}`、`games/metronome`、`apps/web`、`charts/` 生成アセット、CI
- 非対象（M0 でやらない）: カラテや本体、PWA、リアルタイムシンセ、練習モード

## 0. リポジトリ規約

- TypeScript strict。`any` 禁止（`unknown` + 絞り込み）。フレームループ内でのヒープ割り当てゼロ（配列/オブジェクト再利用）。
- Rust: `cargo fmt` / `clippy -D warnings` クリーン。`crates/core`・`crates/synth` は wasm 非依存（`wasm-bindgen` を参照しない）。
- コメント・ドキュメントは日本語可。識別子は英語。
- パッケージ間 import は package.json の依存宣言経由のみ（相対パスで他パッケージへ届くのは禁止）。

### ディレクトリと npm パッケージ名

```
apps/web                → "web" (private)
packages/engine         → "@rhythm/engine"
packages/scene-kit      → "@rhythm/scene-kit"
packages/shell          → "@rhythm/shell"
games/metronome         → "@rhythm/game-metronome"
crates/core | synth | wasm | tools
charts/                 → metronome.mid / metronome.json / dev.sf2（tools で生成しコミット）
```

依存の向き（dependency-cruiser で CI 検査）:

```
games/*  → @rhythm/engine, @rhythm/scene-kit のみ（three 可, react 不可）
shell    → @rhythm/engine のみ（react, zustand 可, three 不可）
engine   → 他パッケージ依存なし（three/react/zustand 不可。wasm-pkg のみ）
scene-kit→ 他パッケージ依存なし（three のみ可）
apps/web → 全部可（合成の唯一の場所）
```

### 主要依存バージョン（常に最新版を採用。package.json が正）

- typescript ^7.0.2 / vite ^8.1.5 / @vitejs/plugin-react ^6.0.3 / vitest ^4.1.10
- three ^0.185.1 / @types/three ^0.185.1
- react ^19.2.7 / react-dom ^19.2.7 / @types/react ^19.2.17 / @types/react-dom ^19.2.3
- zustand ^5.0.14 / oxlint ^1.74.0 / oxfmt ^0.59.0 / dependency-cruiser ^18.1.0 / @playwright/test ^1.61.1
- Rust: rustysynth = "1.3" / midly = "0.5" / serde = "1"(derive) / serde_json = "1" / thiserror = "2" / wasm-bindgen = "0.2" / js-sys = "0.3"

## 1. アセット仕様（charts/）

### 1.1 metronome.mid（`crates/tools` の bin `gen_midi` が生成）

- SMF Format 1、PPQ=480、テンポ 120BPM 固定（set_tempo 500000）、4/4。
- 長さ: カウントイン 2 小節 + 本編 28 小節 = 30 小節 = 120 拍（= 60 秒、1 プレイ約 1 分）。
- 本編は起承転結の 4 セクション構成（C メジャー。起 6 小節 / 承 8 小節 / 転 8 小節（平行短調 Am 系・シンコペーション）/ 結 6 小節（カデンツ→全音符終止））。
- Track 0: テンポ・拍子メタのみ。
- Track "DRUMS"（ch9）: キック key35 / クリック key37 / アクセント key38 / ハイハット key42。カウントイン 2 小節はクリック（小節頭のみアクセント）。
- Track "BASS"（ch1, ProgramChange 1）/ "LEAD"（ch0, ProgramChange 0）/ "HARM"（ch2, ProgramChange 2）: 楽曲本体。
- Track "CUES"（トラック名メタ）: ch0。**カウントイン 2 小節（8 拍）の後**、key 36（通常キュー）と key 38（小節頭等の大キュー）のみ。隣接キュー間隔は 240 ティック（8 分音符）以上。全キューのティックには DRUMS または LEAD の NoteOn が同居する（「聞こえる音を叩く」原則）。**このトラックはレンダ時に除外される**（§3.2）。
- カウントイン: 冒頭 2 小節は DRUMS のみでキューを置かない。曲頭キューにも全接近時間（approachSec）とテンポの手がかり（8 クリック）を保証するため（レビュー指摘による追加。これが無いと曲頭キューが構造的に判定不能でパーフェクト勲章が取得できない）。

### 1.2 metronome.json（オーバレイ、手書きでコミット）

```jsonc
{
  "meta": { "id": "metronome", "midi": "metronome.mid", "soundfont": "dev.sf2" },
  "cueTrack": "CUES",
  "cueMap": { "36": 0, "38": 1 },
  "sfx": {
    "tap": { "percussion": true, "preset": 0, "key": 37, "velocity": 100, "durationSec": 0.3 },
  },
}
```

- `cueMap`: MIDI ノート番号（文字列キー）→ キュー種別 ID（number）。意味付けはゲーム側（0=通常拍, 1=小節頭）。

### 1.3 dev.sf2（`crates/tools` の bin `gen_sf2` が生成、目標 < 100KB）

最小の自前 SF2。必要プリセット:

- bank 0, preset 0 "Lead": 単サイクル矩形波サンプルのループ再生
- bank 0, preset 1 "Bass": 単サイクル三角波サンプルのループ再生
- bank 0, preset 2 "Harm": 単サイクル正弦波サンプルのループ再生
- bank 128, preset 0 "Percussion": key 35 = キック（ピッチスイープサイン）、key 36 = 低いクリック、key 37 = クリック、key 38 = アクセント（高め/強め）、key 42 = ハイハット（固定シード LCG ノイズ）。短い減衰音（~50-250ms）。生成は決定的であること

SF2 バイナリは RIFF `sfbk`（INFO: ifil 2.1, isng, INAM / sdta: smpl 16bit PCM / pdta: phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr の順・各終端レコード必須）。各サンプル末尾に 46 サンプル以上のゼロガード。検証は「rustysynth でロードして各キーをレンダし非無音」をテストで担保。

## 2. crates/core（純 Rust・wasm 非依存・I/O なし）

依存: midly, serde, serde_json, thiserror。`cargo test` で網羅（判定境界・テンポ変換・決定論）。

```rust
pub struct TempoMap { /* PPQ とテンポ変更点列 */ }
impl TempoMap {
    pub fn tick_to_sec(&self, tick: u64) -> f64;
    pub fn beat_to_sec(&self, beat: f64) -> f64;
    pub fn sec_to_beat(&self, sec: f64) -> f64;
}

#[derive(serde::Deserialize)] // camelCase
pub struct Overlay { pub meta: OverlayMeta, pub cue_track: String,
    pub cue_map: std::collections::BTreeMap<String, u16>, /* sfx は core では未使用可 */ }

pub struct Cue { pub time_sec: f64, pub beat: f64, pub kind: u16 }
pub struct Chart { pub cues: Vec<Cue>, pub duration_sec: f64, pub tempo_map: TempoMap }

/// MIDI + オーバレイ → 秒展開済み Chart。cueTrack のノートオンのみをキューとして解釈。
pub fn compile_chart(midi_bytes: &[u8], overlay: &Overlay) -> Result<Chart, ChartError>;

pub struct JudgeConfig { pub just_ms: f64, pub safe_ms: f64 } // 既定 45 / 100
#[derive(Clone, Copy, PartialEq)] pub enum Judgment { Just = 0, Safe = 1, Miss = 2 }
pub struct Input { pub time_sec: f64, pub verb: u16 } // M0 は verb=0(タップ)のみ

pub enum Event {
    CueApproach { cue_index: u32, kind: u16, target_sec: f64 },
    Judged      { cue_index: u32, judgment: Judgment, error_ms: f64 }, // error = input - target（正=遅い）
    AutoMiss    { cue_index: u32 },
}

pub struct Stats { pub total_cues: u32, pub judged: u32, pub just: u32, pub safe: u32, pub miss: u32,
    pub mean_ms: f64, pub std_ms: f64, pub histogram: [u32; 20] /* -100..100ms, 10ms 刻み */ }

pub struct Engine { /* chart, config, approach_sec, 進行状態, Welford 統計 */ }
impl Engine {
    pub fn new(chart: Chart, config: JudgeConfig, approach_sec: f64) -> Self;
    /// 毎フレーム 1 回。inputs は時刻昇順。events はクリアして再利用（割り当てゼロ）。
    pub fn tick(&mut self, now_sec: f64, inputs: &[Input], events: &mut Vec<Event>);
    pub fn stats(&self) -> &Stats;
    pub fn finished(&self, now_sec: f64) -> bool; // 全キュー判定済み or 曲終了
}
```

判定アルゴリズム（確定）:

1. `CueApproach`: `now >= target - approach_sec` になったキューを（時刻順に一度だけ）発火。
2. 入力マッチング: 各入力について、未判定かつ `|input - target| <= safe_ms` のキューのうち **|error| 最小**のものへ割り当て。範囲内になければ入力は無視（空振りはイベントなし）。`|error| <= just_ms` → Just、それ以外 → Safe。
3. `AutoMiss`: `now > target + safe_ms` の未判定キュー。Miss は統計の miss にカウント、誤差統計には含めない。
4. 同一 tick 内も決定論（入力順→キュー順で安定）。float は f64、同値タイは早いキュー優先。

## 3. crates/synth（純 Rust・wasm 非依存）

依存: rustysynth, midly, thiserror。

```rust
pub struct Rendered { pub sample_rate: u32, pub left: Vec<f32>, pub right: Vec<f32> }

/// exclude_track: このトラック名メタを持つトラックを除去してからレンダ（midly でパース→除去→再シリアライズ→rustysynth）
pub fn render_midi(midi: &[u8], sf2: &[u8], sample_rate: u32, exclude_track: Option<&str>)
    -> Result<Rendered, SynthError>;

/// 単発ノート（タップ SFX 用）。percussion=true なら ch9 相当（bank128）を使用。
pub fn render_note(sf2: &[u8], percussion: bool, preset: u8, key: u8, velocity: u8,
    duration_sec: f64, sample_rate: u32) -> Result<Rendered, SynthError>;

/// チャンクレンダ（ロード進捗表示用）。render_midi はこれのラッパ。
pub struct SongRenderer { /* sequencer 保持 */ }
impl SongRenderer {
    pub fn new(midi: &[u8], sf2: &[u8], sample_rate: u32, exclude_track: Option<&str>) -> Result<Self, SynthError>;
    pub fn total_frames(&self) -> usize;     // 曲長 + テイル 1 秒
    pub fn rendered_frames(&self) -> usize;
    pub fn render_chunk(&mut self, max_frames: usize) -> bool; // 完了で true
    pub fn into_rendered(self) -> Rendered;
}
```

テスト: 生成済み `charts/dev.sf2` + `charts/metronome.mid`（`../../charts/` を include_bytes! か fs 読み）で (1) 非無音、(2) 長さ ≒ total_frames、(3) exclude_track 有無で波形が変わる、(4) render_note 非無音、を検証。

## 4. crates/wasm（wasm-bindgen の薄い層）

依存: core, synth, wasm-bindgen, js-sys。`crate-type = ["cdylib", "rlib"]`。ビルドは `wasm-pack build crates/wasm --target web --release --out-dir ../../packages/engine/wasm-pkg --out-name rhythm_wasm`。

```rust
#[wasm_bindgen]
pub struct RenderResult; // getter: sampleRate: u32, left: Float32Array, right: Float32Array

#[wasm_bindgen(js_name = renderNote)]
pub fn render_note(sf2: &[u8], percussion: bool, preset: u8, key: u8, velocity: u8,
    duration_sec: f64, sample_rate: u32) -> Result<RenderResult, JsError>;

#[wasm_bindgen]
pub struct SongRenderer; // コンストラクタ(midi, sf2, sampleRate, excludeTrack?: string)
// totalFrames(): number / renderedFrames(): number / renderChunk(maxFrames): boolean / take(): RenderResult
// ※ take は self 消費でなく &mut self + 内部 Option::take で実装（wasm-bindgen の self 制約回避）

#[wasm_bindgen]
pub struct Session; // コンストラクタ(midi: &[u8], overlay_json: &str, config_json: &str)
// config_json: {"justMs":45,"safeMs":100,"approachSec":1.0}
// durationSec(): number / cueCount(): number
// cuesFlat(): Float64Array  — [timeSec, beat, kind] × N
// tick(nowSec: number, inputs: Float64Array): Float64Array — inputs は [timeSec, verb] × K
// statsJson(): string
// finished(nowSec: number): boolean
```

`tick` の戻り値（イベントレコード、4 × f64 / 件。**内部バッファ再利用**で毎フレーム割り当てしない — 戻りは `js_sys::Float64Array::view` ではなく都度 copy でよいが、Rust 側 Vec は再利用）:

| type        | [0] | [1]      | [2]              | [3]                          |
| ----------- | --- | -------- | ---------------- | ---------------------------- |
| CueApproach | 1   | cueIndex | kind             | targetSec                    |
| Judged      | 2   | cueIndex | judgment (0/1/2) | errorMs（符号付き、正=遅い） |
| AutoMiss    | 3   | cueIndex | 2                | 0                            |

`statsJson()`: `{"totalCues":n,"judged":n,"just":n,"safe":n,"miss":n,"meanMs":x,"stdMs":y,"histogram":{"fromMs":-100,"binMs":10,"counts":[20個]}}`

## 5. packages/engine（TS・依存: wasm-pkg のみ）

エクスポート（`src/index.ts`）: `AudioClock, AudioEngine, InputQueue, GameLoop, loadBinary, RenderClient, initWasm, createSession, SessionHandle, decodeEvents, EngineEvent, Minigame, MinigameContext, VerbSpec, CalibrationStore`

- **AudioClock**: `AudioContext` 保持。`now(): number`。`perfToAudio(perfMs: number): number` — `getOutputTimestamp()` の {contextTime, performanceTime} ペアから offset を EMA（α=0.1、毎秒更新）平滑化。API 不在/0 値なら `currentTime - performance.now()/1000` でフォールバック。テスト可能なよう時刻ソースは注入式（`ClockSources` インタフェース）。
- **AudioEngine**: `unlock()`（ユーザジェスチャ内で resume + 無音バッファ 1 発 + **無音 `<audio loop>` 再生開始**〔iOS サイレントスイッチ対策、data URI の無音 wav〕）。`toAudioBuffer(sampleRate, left, right): AudioBuffer` / `playSong(buffer, whenSec): {startedAt}`（100–200ms 先行予約、`songPos = clock.now() - startedAt`）/ `playSfx(buffer)`（即時）/ `suspend()/resume()`。`visibilitychange` で自動 suspend するリスナ登録 API。
- **InputQueue**: `attach(target)` で `pointerdown` 監視（`{passive: true}` 相当でよいが `touch-action` は CSS 側）。`e.timeStamp` → `clock.perfToAudio + inputOffsetSec` で変換し容量 64 の Float64Array リングへ `[timeSec, verb]`。`drain(): Float64Array`（再利用ビュー、長さ 2K）。タップ即時コールバック `onTap`（SFX 用）。キーボード（Space）も verb 0 として受ける（PC 開発用）。
- **GameLoop**: `start(cb: (nowSec: number) => void)` / `stop()`。rAF。cb 実行時間と fps を EMA 計測（`metrics: {fps, tickMs}`、オブジェクト再利用）。
- **RenderClient**: `renderSong(opts: {midi: Uint8Array, sf2: Uint8Array, sampleRate: number, excludeTrack?: string}, onProgress?: (ratio: number) => void): Promise<{sampleRate, left: Float32Array, right: Float32Array}>` — `new Worker(new URL('./render.worker.ts', import.meta.url), {type:'module'})`。worker 内で wasm init → SongRenderer をチャンク駆動（1 チャンク = sampleRate フレーム）→ progress post → 完了で left/right を transfer。
- **wasm ブリッジ**（`src/wasm.ts`）: `initWasm(): Promise<void>`（`../wasm-pkg/rhythm_wasm.js` の default init。多重呼び出しガード）。`createSession(midi, overlayJson, config): SessionHandle`。`decodeEvents(flat: Float64Array, out: EngineEvent[]): number` — **out 要素をミューテートして再利用**（毎フレーム新規オブジェクトを作らない）。`EngineEvent = {type: 1|2|3, cueIndex: number, a: number, b: number}`。
- **Minigame 契約**（PLAN §5 概形を M0 向けに具体化。型定義のみ）:

```ts
export interface VerbSpec {
  id: number;
  name: string;
}
export interface MinigameContext {
  audio: AudioEngine;
  clock: AudioClock;
  assetBase: string; // チャートアセットの URL ベース
  onFinished(statsJson: string): void; // ゲーム→シェルへの結果通知
}
export interface MinigameScene {
  update(nowSec: number, songPosSec: number): void; // 毎フレーム
  handleEvent(ev: EngineEvent): void; // tick イベント→演出
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
}
export interface Minigame {
  id: string;
  verbs: VerbSpec[];
  load(ctx: MinigameContext, onProgress: (r: number) => void): Promise<void>;
  createScene(canvas: HTMLCanvasElement): MinigameScene;
  start(): void; // 曲再生開始 + ループ開始
  stop(): void;
}
```

- **CalibrationStore**: `{inputOffsetMs, videoOffsetMs}` を localStorage（key `rhythm.calibration.v1`）で永続化。get/set のみ。
- vitest: AudioClock の平滑化・フォールバック、InputQueue のリング境界、decodeEvents、CalibrationStore（localStorage モック）。DOM/AudioContext はモック注入（環境 node）。

## 6. packages/scene-kit（TS・依存: three のみ）

- `createGameRenderer(canvas): {renderer, resize(w,h,dpr), dispose}` — WebGL2, `pixelRatio ≤ 2`, sRGB。
- `createToonMaterial(color: number): MeshToonMaterial` — 3 段グラデーションマップ（DataTexture）共有。
- `addOutline(mesh, scale=1.03, color=0x000000): Mesh` — インバーテッドハル（BackSide）。
- `PortraitCameraRig`: 縦画面用 PerspectiveCamera（fov 縦基準）、`shake(strength)` 減衰付き、`update(dt)`。
- `ObjectPool<T>`: `acquire()/release(t)`、`prealloc(n, factory)`。
- vitest は不要（three 依存のため。型チェックのみ）。

## 7. games/metronome（TS・依存: engine, scene-kit, three）

`Minigame` 実装 `metronomeGame` を default export。アセットは Vite の `?url` import（`charts/metronome.mid?url` 等はパッケージから `../../charts/` 相対 + `?url`）。

- load: mid/json/sf2 を fetch → RenderClient で曲レンダ（進捗転送）→ AudioBuffer 化、tap SFX を renderNote でレンダ、Session 生成（approachSec = 1.0 = 2 拍 @120BPM）。
- シーン（ローポリ・トゥーン、縦構図）: 下 1/3 にヒットリング（パッド）。キューは CueApproach で奥（z 遠方・上方）にスポーンし、`(targetSec - songPos) / approachSec` の補間でリングへ直線飛来。判定で色/挙動を変えて退場（Just=金+星スケール、Safe=青でよろけ、Miss=赤で落下）。小節頭キュー（kind 1）は大きめ。オブジェクトはプール。
- タップで即 SFX 再生（InputQueue.onTap → playSfx）。
- デバッグ HUD（DOM 直更新、React 不使用、4Hz）: fps / tickMs / 判定数 (just/safe/miss) / mean±σ ms / 誤差ヒストグラム（バー文字）。`videoOffsetMs` は表示補間にのみ加算。
- 終了（Session.finished）で `ctx.onFinished(statsJson)`。

## 8. packages/shell（TS/React・依存: engine, react, react-dom, zustand）

- Zustand **vanilla store**（`createStore`）+ `useStore` バインド。`AppState = 'title' | 'loading' | 'play' | 'result'`。`{appState, loadProgress, resultJson, calibration, actions...}`。ループ側から非 React で書けるよう store 自体もエクスポート。
- 画面: Title（「タップではじめる」）/ Loading（進捗バー）/ Result（統計と ランク: やりなおし/平凡/ハイレベル、ノーミスでパーフェクト勲章。ランク規則: miss率 > 20% → やりなおし、miss率 ≤ 5% かつ |mean| ≤ 20ms かつ σ ≤ 30ms → ハイレベル、それ以外 → 平凡）/ Settings（inputOffsetMs / videoOffsetMs スライダ、CalibrationStore へ保存）/ 横向き警告オーバレイ（`matchMedia('(orientation: landscape)')`）。
- ゲーム中は React ツリーを一切更新しない（HUD はゲーム側 DOM）。
- vitest: ランク判定ロジックの単体テスト（純関数に切り出す）。

## 9. apps/web（合成・依存: 全部可）

- `index.html`: `viewport-fit=cover`, user-scalable=no, `touch-action: none`, `100dvh`, `safe-area-inset-*` padding, ダーク背景。canvas は全画面固定配置、React ルートはその上のオーバレイ。
- ゲームレジストリ: `const games = { metronome: () => import('@rhythm/game-metronome') }`（動的 import = コード分割の実証）。
- フロー: Title タップ → `audio.unlock()` → registry から動的 import → `load()`（進捗を store へ）→ `createScene` → `start()` → 終了イベントで store を result へ。
- `vite.config.ts`: `base: './'`, `assetsInclude: ['**/*.mid', '**/*.sf2']`, `worker: {format:'es'}`, `server.fs.allow` にリポジトリルート, `server.host: true`（実機デバッグ）。
- Playwright（`apps/web/e2e/smoke.spec.ts`）: モバイルビューポート（390×844, hasTouch）で preview を開き、タイトル表示 → タップ → ローディング → プレイ（canvas 描画 & HUD 出現、タイムアウト 60s）まで。`webServer` で `vite preview` 起動。

## 10. ルート構成ファイル（オーケストレーターが用意済み）

root package.json（scripts: dev/build/build:wasm/typecheck/lint/test/test:e2e/depcruise/gen:assets）、pnpm-workspace.yaml、Cargo.toml（workspace）、.oxlintrc.json、tsconfig.base.json、.dependency-cruiser.cjs、.gitignore、.github/workflows/ci.yml。**実装エージェントはルートファイルを変更しない**（変更が必要ならレポートに書く）。

## 11. CI（.github/workflows/ci.yml）

- job `rust`: stable toolchain + rust-cache → `cargo fmt --check` → `cargo clippy --workspace --all-targets -- -D warnings` → `cargo test --workspace`
- job `web`: rust(wasm32) + wasm-pack + pnpm → `pnpm install --frozen-lockfile` → `pnpm build:wasm` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm depcruise` → `pnpm build` → Playwright smoke（chromium のみ）
