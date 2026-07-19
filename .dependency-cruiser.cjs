/**
 * モジュール境界検査（docs/PLAN.md §5 / docs/M0-SPEC.md §0 の依存の向きを強制）
 *
 * games/*   → engine, scene-kit のみ（three 可、react/zustand 不可）
 * shell     → engine のみ（react/zustand 可、three 不可）
 * engine    → 他 workspace パッケージ依存なし（three/react/zustand 不可）
 * scene-kit → 他 workspace パッケージ依存なし（three のみ可）
 * apps/web  → 制限なし（合成の唯一の場所）
 */
module.exports = {
  forbidden: [
    {
      name: "games-only-engine-scenekit",
      severity: "error",
      from: { path: "^games/" },
      to: {
        path: "^(packages/shell|apps/)",
      },
    },
    {
      name: "games-no-cross-game",
      severity: "error",
      from: { path: "^games/([^/]+)/" },
      to: { path: "^games/", pathNot: "^games/$1/" },
    },
    {
      name: "games-no-react",
      severity: "error",
      from: { path: "^games/" },
      to: { path: "node_modules/(react|react-dom|zustand)/" },
    },
    {
      name: "shell-only-engine",
      severity: "error",
      from: { path: "^packages/shell/" },
      to: { path: "^(packages/scene-kit|games/|apps/)" },
    },
    {
      name: "shell-no-three",
      severity: "error",
      from: { path: "^packages/shell/" },
      to: { path: "node_modules/three/" },
    },
    {
      name: "engine-standalone",
      severity: "error",
      from: { path: "^packages/engine/" },
      to: { path: "^(packages/(shell|scene-kit)|games/|apps/)" },
    },
    {
      name: "engine-no-framework",
      severity: "error",
      from: { path: "^packages/engine/" },
      to: { path: "node_modules/(three|react|react-dom|zustand)/" },
    },
    {
      name: "scenekit-standalone",
      severity: "error",
      from: { path: "^packages/scene-kit/" },
      to: { path: "^(packages/(shell|engine)|games/|apps/)" },
    },
    {
      name: "scenekit-only-three",
      severity: "error",
      from: { path: "^packages/scene-kit/" },
      to: { path: "node_modules/(react|react-dom|zustand)/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      // pnpm の隔離で解決できない import（未宣言依存への越境を含む）を検出する
      name: "no-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    exclude: { path: "(wasm-pkg|\\.test\\.ts$|e2e/|/dist/|/test-results/|/playwright-report/)" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
  },
};
