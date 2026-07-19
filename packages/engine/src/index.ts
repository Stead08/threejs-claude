// packages/engine の公開エクスポート（M0-SPEC §5）。

export { AudioClock, fromAudioContext } from "./clock";
export type { ClockSources } from "./clock";

export { AudioEngine } from "./audio";
export type { AudioEngineOptions, VisibilityDocument } from "./audio";

export { InputQueue } from "./input";
export type { InputQueueOptions } from "./input";

export { GameLoop } from "./loop";
export type { GameLoopOptions, LoopMetrics } from "./loop";

export { loadBinary } from "./loader";

export { RenderClient } from "./render-client";
export type { RenderSongOptions, RenderedSong } from "./render-client";

export { initWasm, createSession, renderNoteBuffer } from "./wasm";
export type { SessionHandle, SessionConfig, RenderedNote } from "./wasm";

export { decodeEvents } from "./events";
export type { EngineEvent } from "./events";

export { CalibrationStore } from "./calibration";
export type { Calibration, StorageLike } from "./calibration";

export { HAPTIC_TAP_MS, detectHapticsMode, hapticTap } from "./haptics";
export type { HapticsMode, NavigatorLike } from "./haptics";

export type { Minigame, MinigameContext, MinigameScene, VerbSpec } from "./minigame";
