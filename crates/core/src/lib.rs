//! rhythm-core — リズムゲームの純ロジックコア。
//!
//! PLAN §3 のレイヤー原則に従い、このクレートは **I/O・時計・乱数・wasm-bindgen を持たない**。
//! 入力（MIDI バイト列・オーバレイ JSON・フレーム毎の時刻と入力）から
//! 決定論的にイベント列・統計を計算するだけの純関数群で構成する。
//!
//! 主要要素:
//! - [`TempoMap`]: PPQ とテンポ変更点列から tick/beat ⇄ 秒 を区間積分で相互変換。
//! - [`Overlay`]: 譜面オーバレイ JSON（serde, camelCase）。
//! - [`compile_chart`]: MIDI + オーバレイ → 秒展開済み [`Chart`]。
//! - [`Engine`]: 判定エンジン（キュー接近・入力マッチング・オートミス・統計）。

mod chart;
mod engine;
mod overlay;
mod tempo;

pub use chart::{compile_chart, Chart, ChartError, Cue};
pub use engine::{Engine, Event, Input, JudgeConfig, Judgment, Stats};
pub use overlay::{Overlay, OverlayMeta};
pub use tempo::TempoMap;

#[cfg(test)]
mod tests;
