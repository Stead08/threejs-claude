# threejs-claude — 3D リズムゲーム（モバイルブラウザ専用）

リズム天国ライクなコール＆レスポンス型 3D リズムゲーム。スマホ縦持ち固定・タップ 1 動詞。
計画は [docs/PLAN.md](docs/PLAN.md)、M0 の実装契約は [docs/M0-SPEC.md](docs/M0-SPEC.md) を参照。
開発時の依存境界・コマンド・落とし穴は [CLAUDE.md](CLAUDE.md) にまとめている。

## 技術スタック

- **レンダリング**: Three.js (WebGL2) を素で使用（React はゲーム外シェルのみ）
- **ロジックコア**: Rust → Wasm（判定・譜面コンパイル・シンセ）
- **音源**: MIDI + SoundFont を rustysynth でロード時オフラインレンダ（音声ファイル非同梱）
- **タイミング**: `AudioContext.currentTime` を唯一のマスタークロックとする判定設計
- **ハプティクス**: Android は Vibration API、iOS Safari は透明な `<input type="checkbox" switch>` オーバレイ（WebKit ネイティブスイッチの触覚。iOS 26.5 以降プログラム発火は不可のため実タップで鳴らす）
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

| コマンド                                   | 内容                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm preview` | apps/web の開発・ビルド・プレビュー                                          |
| `pnpm build:wasm`                          | wasm-pack ビルド（TS 側より先に一度実行が必要）                              |
| `pnpm typecheck`                           | 全パッケージ tsc --noEmit（TypeScript 7）                                    |
| `pnpm lint` / `pnpm format`                | oxlint / oxfmt                                                               |
| `pnpm test`                                | Vitest（packages/*・games/* の各 vitest.config.ts）                          |
| `pnpm test:e2e`                            | Playwright スモーク（要 `pnpm build`）                                       |
| `pnpm depcruise`                           | モジュール境界検査                                                           |
| `cargo test --workspace`                   | Rust テスト（判定・譜面・シンセ・SF2 生成）                                  |
| `pnpm gen:assets`                          | charts/ の MIDI・SF2 を再生成                                                |
| `pnpm run build:cf`                        | Workers Builds 用フルビルド（rustup/wasm-pack 導入 → wasm → wasm-opt → web） |
| `pnpm deploy`                              | ビルドして Cloudflare Workers にデプロイ                                     |

## デプロイ（Cloudflare Workers Builds）

`apps/web/wrangler.jsonc` の Static Assets 設定で `apps/web/dist/` を静的配信する
（SPA フォールバックあり）。`/api/*` のみ Worker スクリプト（`apps/web/src/worker.ts`、
テレメトリー受け口）が先に実行される。デプロイは Cloudflare の
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)（Git 連携）で行う。

ダッシュボード（Workers & Pages → Create → Import a repository）での設定:

| 項目                                 | 値                                                |
| ------------------------------------ | ------------------------------------------------- |
| Git repository / branch              | `Stead08/threejs-claude` / `main`                 |
| Root directory                       | （空欄 = リポジトリルート）                       |
| Build command                        | `pnpm run build:cf`                               |
| Deploy command                       | `pnpm --filter web deploy`                        |
| Non-production branch deploy command | `pnpm --filter web exec wrangler versions upload` |

ビルドイメージに wasm32 ターゲット・wasm-pack が無いため、`scripts/workers-build.sh`
（`pnpm run build:cf`）が rustup / wasm-pack をブートストラップし、
wasm-opt（npm の binaryen）でサイズ最適化してから Vite ビルドする。

- **手動デプロイ**: `pnpm run build:cf && pnpm --filter web deploy`（初回は `wrangler login`）。
- **ローカル確認**: `pnpm build` 後に `pnpm --filter web exec wrangler dev` で本番同等の配信を検証できる。

将来 AudioWorklet + SAB 化で COOP/COEP が必要になった場合も、`apps/web/public/_headers`
にヘッダーを置けば Workers Static Assets がそのまま配信する（Pages 移行は不要）。

## テレメトリー（実機ログ）

iOS Safari 等の実機で「読み込み中のまま進まない」を遠隔診断するためのクライアントテレメトリーを備える。

- **クライアント** (`apps/web/src/telemetry.ts`): タップ〜プレイ到達までの段階マーク
  （unlock / モジュールロード / レンダ進捗 0.1 刻み / シーン生成）をブレッドクラムとして記録し、
  グローバルエラー・起動失敗・「タップ後 30 秒で play 未到達」（load-stuck）を
  `POST /api/telemetry` へ送信する。送信失敗はゲームへ影響しない。
- **サーバ** (`apps/web/src/worker.ts`): 受信 JSON を構造化ログとして出力する。
  `observability.enabled`（wrangler.jsonc）により [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
  に 7 日間保存される。

ログの見方:

- ダッシュボード: Workers & Pages → `threejs-claude` → **Logs** タブ。
  `$cloudflare.$metadata.error` や `$workers.event` でフィルタでき、エラー系イベント
  （`window-error` / `unhandled-rejection` / `start-failed` / `load-stuck`）は error レベルで出る。
- CLI: `pnpm --filter web exec wrangler tail`（リアルタイム）。

`load-stuck` ログの `breadcrumbs` で最後に到達した段階（例: `audio:unlocked` 無し → unlock で停止、
`load:progress 0.8` 止まり → wasm 初期化で停止）を特定できる。

## リポジトリ構成

```
apps/web/            Vite エントリ。ゲームレジストリ(動的import)・合成のみ
packages/engine/     GameLoop / AudioEngine / AudioClock / InputQueue / wasm ブリッジ / Minigame 契約
packages/scene-kit/  three 共通部品（トゥーン・輪郭・カメラリグ・プール）
packages/shell/      React シェル（タイトル/設定/リザルト）+ Zustand store
games/metronome/     dev 用ミニゲーム（M0 縦切り・契約実証）
games/uraomote/      ウラオモテ（表拍⇔裏拍が入れ替わるリズムゲーム）
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

2 本目のミニゲーム「ウラオモテ」を追加（既定ゲーム。`?game=metronome` で旧ゲームに切替可能）:
リズム天国のウラオモテ風に、セクションごとに表拍タップ⇔裏拍タップが入れ替わる。
楽曲は BPM116 / A マイナーのオリジナル（`gen:assets` の `gen_midi --song uraomote` で生成、
音色は dev.sf2 に追加した三角波ベース・サイン波コード・キック/クラップ/ハイハットで演奏）。
切替の直前には 16 分音符の上昇/下降リフとクラップロールで「ウラ!／オモテ!」を予告する。
