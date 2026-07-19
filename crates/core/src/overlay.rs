//! 譜面オーバレイ（MIDI に載らない演出/マッピング情報）の serde 定義。
//!
//! JSON は camelCase。`sfx` 等の未知フィールドは serde の既定で無視される
//! （core では未使用）。

use std::collections::BTreeMap;

/// オーバレイのメタ情報。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMeta {
    pub id: String,
    pub midi: String,
    pub soundfont: String,
}

/// 譜面オーバレイ。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub meta: OverlayMeta,
    /// キューとして解釈するトラックのトラック名メタ。
    pub cue_track: String,
    /// MIDI ノート番号（文字列キー）→ キュー種別 ID。
    pub cue_map: BTreeMap<String, u16>,
}

impl Overlay {
    /// JSON 文字列からオーバレイをデシリアライズする。
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}
