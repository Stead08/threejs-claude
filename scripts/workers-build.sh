#!/usr/bin/env bash
# Cloudflare Workers Builds 用ビルドスクリプト（リポジトリルートで実行）。
# ビルドイメージに Rust の wasm32 ターゲットと wasm-pack が無いため、ここでブートストラップする。
# ダッシュボード設定: Build command = `pnpm run build:cf` / Deploy command = `pnpm --filter web deploy`
set -euo pipefail

# --- Rust ツールチェーン（wasm32 ターゲット付き） ---
if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown
else
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
  source "$HOME/.cargo/env"
fi

# --- wasm-pack（プリビルトバイナリを取得。cargo install はビルドが遅いので避ける） ---
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
  export PATH="$HOME/.cargo/bin:$PATH"
fi

pnpm install --frozen-lockfile

pnpm build:wasm

# crates/wasm 側で wasm-pack の wasm-opt 自動実行を無効化しているため、
# ci.yml と同様にここで明示的にサイズ最適化する（npm の binaryen を使用）。
pnpm exec wasm-opt -Os -all \
  -o packages/engine/wasm-pkg/rhythm_wasm_bg.wasm \
  packages/engine/wasm-pkg/rhythm_wasm_bg.wasm

pnpm build
