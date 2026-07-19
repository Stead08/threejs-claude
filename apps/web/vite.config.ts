// apps/web の Vite 設定（M0-SPEC §9）。合成の唯一の場所として全パッケージを束ねるエントリ。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages 等の静的ホスティングでサブパス配信しても崩れないよう相対パスにする。
  base: "./",
  plugins: [react()],
  // charts/*.mid・*.sf2 をバイナリアセットとして `?url` import できるようにする。
  assetsInclude: ["**/*.mid", "**/*.sf2"],
  worker: {
    // RenderClient が生成する render.worker.ts を ESM ワーカーとしてビルドする。
    format: "es",
  },
  server: {
    // 実機デバッグ用に LAN からアクセス可能にする（`vite --host`）。
    host: true,
    fs: {
      // モノレポルート（charts/ 等 workspace 外アセット）への参照を許可する。
      allow: ["../.."],
    },
  },
});
