# CLAUDE.md

このリポジトリで作業する Claude Code 向けの実務ガイド。全体像・セットアップ・デプロイ手順は
[README.md](README.md)、設計は [docs/PLAN.md](docs/PLAN.md) / [docs/M0-SPEC.md](docs/M0-SPEC.md) を参照。

## 何のプロジェクトか

リズム天国ライクなコール＆レスポンス型 3D リズムゲーム（**スマホ縦持ち固定・タップ 1 動詞**）。
描画は Three.js（WebGL2）を素で使用、ロジックコア（判定・譜面コンパイル・シンセ）は Rust → Wasm。
音源は MIDI + SoundFont をロード時にオフラインレンダするため、音声ファイルは同梱しない。
タイミング判定は `AudioContext.currentTime` を唯一のマスタークロックとする。

## 頻用コマンド

```bash
pnpm build:wasm      # crates/wasm → packages/engine/wasm-pkg。TS 側より先に一度必須
pnpm dev             # vite dev（--host 付き。実機は同一 LAN から）
pnpm typecheck       # 全パッケージ tsc --noEmit
pnpm lint            # oxlint --deny-warnings
pnpm format          # oxfmt（format:check で検査のみ）
pnpm test            # Vitest（packages/engine, packages/shell, games/*）
pnpm test:e2e        # Playwright スモーク（要 pnpm build）
pnpm depcruise       # モジュール境界検査
cargo test --workspace   # Rust テスト
pnpm gen:assets      # charts/ の MIDI・SF2 を再生成（Rust ツール実行）
```

作業前提: Node 22+ / pnpm 10 / Rust stable (1.87+) / wasm32 ターゲット / wasm-pack。
**Rust を触ったら `pnpm build:wasm` を再実行**してから TS 側を確認すること。

## アーキテクチャの要（モジュラモノリス）

pnpm + cargo workspace。パッケージ境界は **dependency-cruiser で CI 強制**（`.dependency-cruiser.cjs`）。
新しい import を足す前に、以下の依存の向きを必ず守る:

| パッケージ         | 許可される依存                       | 禁止                          |
| ------------------ | ------------------------------------ | ----------------------------- |
| `games/*`          | `engine`, `scene-kit`, `three`       | react/zustand、他 game        |
| `packages/shell`   | `engine`, react/zustand              | three、scene-kit、games       |
| `packages/engine`  | （workspace 依存なし）               | three/react/zustand、他 pkg   |
| `packages/scene-kit` | `three` のみ                       | 他 workspace パッケージ       |
| `apps/web`         | 制限なし（**合成の唯一の場所**）     | —                             |

- `packages/engine`: GameLoop / AudioEngine / AudioClock / InputQueue / wasm ブリッジ / Minigame 契約。
  フレームワーク非依存。ミニゲーム契約型は `packages/engine/src/minigame.ts`。
- `packages/scene-kit`: three 共通部品（トゥーン・輪郭・カメラリグ・オブジェクトプール）。
- `packages/shell`: React シェル（タイトル/設定/リザルト）+ Zustand store。three は使わない。
- `games/*`: 各ミニゲーム。`engine`/`scene-kit` のみに依存し React には触れない。
- `apps/web`: Vite エントリ。ゲームレジストリ（動的 import）と合成だけを行う。
- Rust 側: `crates/core`（Conductor / 譜面コンパイル / 判定 / 統計、wasm 非依存・決定論）、
  `crates/synth`（MIDI → PCM）、`crates/wasm`（wasm-bindgen 結合層）、`crates/tools`（アセット生成）。

## ゲームの追加・切替

- 起動ゲームは `apps/web/src/main.tsx` のレジストリで解決。`?game=<id>` で初期選択を切替できる
  （現行の既定は `uraomote`、旧デモは `?game=metronome`）。
- 新ミニゲームは `games/<name>/` に置き `Minigame` 契約（`load` / `createScene` / verbs 等）を実装、
  レジストリへ登録する。境界検査に通るよう react/zustand・他 game を import しないこと。

## 注意点・落とし穴

- **wasm-opt**: `crates/wasm` は wasm-pack の wasm-opt 自動実行を無効化している（サンドボックスで
  binaryen の DL が egress 遮断されるため）。サイズ最適化は devDependencies に固定した
  `binaryen` の wasm-opt で行う。**apt の binaryen は使わない**（noble の 108 は wasm-bindgen 0.2.126 の
  出力を壊し `WebAssembly.Table.grow` が実行時に失敗する）。CI・`scripts/workers-build.sh` は同一手順。
- **wasm gz サイズ予算 400KB**: CI がゲート。大きくしたら理由を確認。
- **ハプティクス**: Android は Vibration API、iOS Safari は透明な `<input type="checkbox" switch>`
  オーバレイ（`packages/shell/src/HapticSwitch.tsx` 等）。iOS 26.5 以降プログラム発火は不可のため実タップで鳴らす。
- **テレメトリー**: 実機の「読み込み中で止まる」を遠隔診断する仕組み（`apps/web/src/telemetry.ts` →
  `POST /api/telemetry` → `apps/web/src/worker.ts` → Workers Logs）。挙動を変えるときは breadcrumb を壊さない。
- コミット・コメント・README は**日本語**で揃える（既存に倣う）。

## CI が回すこと（`.github/workflows/ci.yml`）

Rust: `cargo fmt --check` / `clippy -D warnings` / `test`。
Web: `build:wasm` → wasm-opt → `lint` / `format:check` / `typecheck` / `test` / `depcruise` / `build` / `test:e2e`。
push/PR 前に該当分をローカルで通しておくこと。
