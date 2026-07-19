// packages/shell の公開エクスポート（M0-SPEC §8）。

export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";

export { shellStore, calibrationStore, useShellStore } from "./store";
export type { ShellState, AppState } from "./store";

export { rank, RANK_LABELS, PERFECT_LABEL } from "./rank";
export type { Stats, RankHistogram, RankGrade, RankResult } from "./rank";

export { parseStats } from "./parse-stats";

export { HapticButton } from "./HapticButton";
export type { HapticButtonProps } from "./HapticButton";
export { HapticSwitch } from "./HapticSwitch";
export type { HapticSwitchProps } from "./HapticSwitch";
export { PlayHapticLayer } from "./PlayHapticLayer";

export { TitleScreen } from "./screens/TitleScreen";
export { LoadingScreen } from "./screens/LoadingScreen";
export { ResultScreen } from "./screens/ResultScreen";
export { SettingsScreen } from "./screens/SettingsScreen";
export { TutorialScreen, TUTORIAL_SEEN_KEY } from "./screens/TutorialScreen";
export { OrientationWarning } from "./screens/OrientationWarning";

export { uiTapSound, uiConfirmSound, playResultJingle } from "./ui-sfx";
