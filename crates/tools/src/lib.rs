//! tools — 開発用アセット生成（`gen_midi` / `gen_sf2` バイナリの実体ロジック）。
//!
//! docs/M0-SPEC.md §1.1 / §1.3 の実装契約に従う。
//! - [`build_metronome_midi`] : 起承転結構成の 1 分楽曲 SMF
//!   （Format1/PPQ480/120BPM/カウントイン 2 小節 + 本編 28 小節）。
//! - [`build_dev_sf2`] : 最小 SF2（Lead/Bass/Harm + パーカッション）。std のみで手書き生成。

mod midi;
mod sf2;

pub use midi::build_metronome_midi;
pub use sf2::build_dev_sf2;
