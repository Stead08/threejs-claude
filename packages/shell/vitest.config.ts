import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // wasm-pkg は wasm-pack のビルド成果物で未ビルドのことがあるため、
      // engine の wasm.ts が参照する specifier をテスト用スタブへ差し替える
      // （store.test.ts が @rhythm/engine を import できるようにする）。
      "../wasm-pkg/rhythm_wasm.js": fileURLToPath(
        new URL("./src/test-stubs/rhythm-wasm-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
