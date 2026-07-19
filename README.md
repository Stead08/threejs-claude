# threejs-claude — 3D リズムゲーム（モバイルブラウザ専用）

リズム天国ライクなコール＆レスポンス型 3D リズムゲーム。スマホ縦持ち固定・タップ 1 動詞。
計画は [docs/PLAN.md](docs/PLAN.md)、M0 の実装契約は [docs/M0-SPEC.md](docs/M0-SPEC.md) を参照。

## 技術スタック

- **レンダリング**: Three.js (WebGL2) を素で使用（React はゲーム外シェルのみ）
- **ロジックコア**: Rust → Wasm（判定・譜面コンパイル・シンセ）
- **音源**: MIDI + SoundFont を rustysynth でロード時オフラインレンダ（音声ファイル非同梱）
- **タイミング**: `AudioContext.currentTime` を唯一のマスタークロックとする判定設計
- **構成**: pnpm + cargo workspace のモジュラモノリス（境界は dependency-cruiser で CI 強制）

## セットアップ

必要: Node 22+ / pnpm 10 / Rust stable (1.87+) / wasm32 ターゲット / wasm-pack

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack          # または各 OS のバイナリ配布
pnpm install
pnpm build:wasm                  # crates/wasm → packages/engine/wasm-pkg
pnpm dev                         # vite dev server (--host 付き、実機は同一 LAN から)
```

## 主要コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm preview` | apps/web の開発・ビルド・プレビュー |
| `pnpm build:wasm` | wasm-pack ビルド（TS 側より先に一度実行が必要） |
| `pnpm typecheck` | 全パッケージ tsc --noEmit（TypeScript 7） |
| `pnpm lint` / `pnpm format` | oxlint / oxfmt |
| `pnpm test` | Vitest（packages/engine, packages/shell） |
| `pnpm test:e2e` | Playwright スモーク（要 `pnpm build`） |
| `pnpm depcruise` | モジュール境界検査 |
| `cargo test --workspace` | Rust テスト（判定・譜面・シンセ・SF2 生成） |
| `pnpm gen:assets` | charts/ の MIDI・SF2 を再生成 |
| `pnpm deploy` | ビルドして Cloudflare Workers にデプロイ |

## デプロイ（Cloudflare Workers）

`apps/web/wrangler.jsonc` の Static Assets 設定で `apps/web/dist/` を静的配信する
（Worker スクリプトなし・SPA フォールバックあり）。

- **CI 自動デプロイ**: main への push で `.github/workflows/deploy.yml` が
  wasm → web をビルドし `wrangler deploy` する。リポジトリシークレット
  `CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit 権限）と `CLOUDFLARE_ACCOUNT_ID` が必要。
- **手動デプロイ**: `pnpm build:wasm && pnpm deploy`（初回は `pnpm --filter web exec wrangler login`）。
- **ローカル確認**: `pnpm build` 後に `pnpm --filter web exec wrangler dev` で本番同等の配信を検証できる。

将来 AudioWorklet + SAB 化で COOP/COEP が必要になった場合も、`apps/web/public/_headers`
にヘッダーを置けば Workers Static Assets がそのまま配信する（Pages 移行は不要）。

## リポジトリ構成

```
apps/web/            Vite エントリ。ゲームレジストリ(動的import)・合成のみ
packages/engine/     GameLoop / AudioEngine / AudioClock / InputQueue / wasm ブリッジ / Minigame 契約
packages/scene-kit/  three 共通部品（トゥーン・輪郭・カメラリグ・プール）
packages/shell/      React シェル（タイトル/設定/リザルト）+ Zustand store
games/metronome/     dev 用ミニゲーム（M0 縦切り・契約実証）
crates/core/         Conductor / 譜面コンパイル / 判定 / 統計（wasm 非依存・決定論）
crates/synth/        midly + rustysynth: MIDI → PCM オフラインレンダ
crates/wasm/         wasm-bindgen 結合層
crates/tools/        gen_midi / gen_sf2（開発用アセット生成）
charts/              MIDI + オーバレイ JSON + SF2
```

依存の向き: `games/* → engine, scene-kit` / `shell → engine` / `apps/web → 全部`（合成の唯一の場所）。

## 現在のステータス

M0（メトロノーム縦切り）実装済み: タイトル → ロード（Worker 内 Wasm シンセレンダ・進捗表示）→
プレイ（タップ判定・誤差 HUD）→ リザルト（ランク判定）。次は実機での誤差分布計測（M0 Done 条件）。
