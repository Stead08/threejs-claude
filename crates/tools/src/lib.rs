//! tools — 開発用アセット生成（`gen_midi` / `gen_sf2` / `render_wav` バイナリの実体ロジック）。
//!
//! docs/M0-SPEC.md §1.1 / §1.3 の実装契約に従う。
//! - [`build_metronome_midi`] : メトロノーム譜面 SMF（Format1/PPQ480/120BPM/64 小節）。
//! - [`build_uraomote_midi`] : 「ウラオモテ」譜面 SMF（Format1/PPQ480/≒116BPM/32 小節 + フィナーレ）。
//! - [`build_dev_sf2`] : 最小 SF2（矩形波 Lead + パーカッション）。std のみで手書き生成。

mod midi;
mod sf2;
mod uraomote;

pub use midi::build_metronome_midi;
pub use sf2::build_dev_sf2;
pub use uraomote::build_uraomote_midi;
