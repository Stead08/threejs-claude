//! rhythm-wasm — wasm-bindgen の薄い層。
//!
//! docs/M0-SPEC.md §4 の実装契約に従う。`rhythm-core`（判定・譜面コンパイル）と
//! `rhythm-synth`（MIDI + SoundFont オフラインレンダ）を JS から呼べる形に束ねるだけで、
//! ロジックは持たない。
//!
//! - [`RenderResult`] — レンダ結果（sampleRate / left / right）を JS へ橋渡しする薄いラッパ。
//! - [`render_note`] — 単発ノート（タップ SFX 用）をレンダする。
//! - [`SongRenderer`] — チャンク駆動の曲レンダ（ロード進捗表示用）。
//! - [`Session`] — 譜面コンパイル済みの判定エンジンを 1 フレーム 1 回 `tick` するハンドル。

mod render;
mod session;

pub use render::{render_note, RenderResult, SongRenderer};
pub use session::Session;
