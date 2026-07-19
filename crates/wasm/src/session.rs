//! `rhythm-core` の譜面コンパイル・判定エンジンを wasm へ橋渡しする。
//!
//! フレームループ相当の [`Session::tick`] は Rust 側の中間バッファ（入力変換・
//! イベント・フラット出力）を全て再利用し、毎フレームのヒープ割り当てを避ける。

use js_sys::Float64Array;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

use rhythm_core::{compile_chart, Engine, Event, Input, JudgeConfig, Judgment, Overlay};

/// `config_json` のデシリアライズ形（camelCase）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionConfig {
    just_ms: f64,
    safe_ms: f64,
    approach_sec: f64,
}

/// 譜面コンパイル済みの判定エンジンを保持し、1 フレーム 1 回 `tick` するハンドル。
#[wasm_bindgen]
pub struct Session {
    engine: Engine,
    duration_sec: f64,
    cue_count: u32,
    /// `[timeSec, beat, kind] × N`。コンストラクタで一度だけ計算し不変。
    cues_flat: Vec<f64>,
    /// `tick` の入力変換バッファ（再利用）。
    inputs_buf: Vec<Input>,
    /// `Engine::tick` のイベント出力バッファ（再利用）。
    events_buf: Vec<Event>,
    /// `tick` の戻り値フラット化バッファ（再利用、都度 `Float64Array` へ copy）。
    out_buf: Vec<f64>,
}

#[wasm_bindgen]
impl Session {
    /// `overlay_json` は `rhythm-core::Overlay`、`config_json` は
    /// `{"justMs":45,"safeMs":100,"approachSec":1.0}` 形式。
    #[wasm_bindgen(constructor)]
    pub fn new(midi: &[u8], overlay_json: &str, config_json: &str) -> Result<Session, JsError> {
        let overlay = Overlay::from_json(overlay_json)
            .map_err(|e| JsError::new(&format!("overlay JSON のパースに失敗しました: {e}")))?;
        let chart = compile_chart(midi, &overlay)
            .map_err(|e| JsError::new(&format!("譜面のコンパイルに失敗しました: {e}")))?;
        let config: SessionConfig = serde_json::from_str(config_json)
            .map_err(|e| JsError::new(&format!("config JSON のパースに失敗しました: {e}")))?;

        let duration_sec = chart.duration_sec;
        let cue_count = chart.cues.len() as u32;
        let mut cues_flat = Vec::with_capacity(chart.cues.len() * 3);
        for cue in &chart.cues {
            cues_flat.push(cue.time_sec);
            cues_flat.push(cue.beat);
            cues_flat.push(f64::from(cue.kind));
        }

        let judge_config = JudgeConfig {
            just_ms: config.just_ms,
            safe_ms: config.safe_ms,
        };
        let engine = Engine::new(chart, judge_config, config.approach_sec);

        Ok(Session {
            engine,
            duration_sec,
            cue_count,
            cues_flat,
            inputs_buf: Vec::new(),
            events_buf: Vec::new(),
            out_buf: Vec::new(),
        })
    }

    /// 曲の総尺（秒）。
    #[wasm_bindgen(js_name = durationSec)]
    pub fn duration_sec(&self) -> f64 {
        self.duration_sec
    }

    /// 譜面のキュー総数。
    #[wasm_bindgen(js_name = cueCount)]
    pub fn cue_count(&self) -> u32 {
        self.cue_count
    }

    /// キュー列（`[timeSec, beat, kind] × N`）。
    #[wasm_bindgen(js_name = cuesFlat)]
    pub fn cues_flat(&self) -> Float64Array {
        Float64Array::from(self.cues_flat.as_slice())
    }

    /// 毎フレーム 1 回。`inputs` は時刻昇順の `[timeSec, verb] × K`。
    /// 戻りはイベントレコード `[type, cueIndex, a, b] × N`
    /// （CueApproach=1 / Judged=2 / AutoMiss=3、詳細は docs/M0-SPEC.md §4）。
    pub fn tick(&mut self, now_sec: f64, inputs: &[f64]) -> Float64Array {
        self.inputs_buf.clear();
        let pair_count = inputs.len() / 2;
        for i in 0..pair_count {
            self.inputs_buf.push(Input {
                time_sec: inputs[i * 2],
                verb: inputs[i * 2 + 1] as u16,
            });
        }

        self.engine
            .tick(now_sec, &self.inputs_buf, &mut self.events_buf);

        self.out_buf.clear();
        for ev in &self.events_buf {
            match *ev {
                Event::CueApproach {
                    cue_index,
                    kind,
                    target_sec,
                } => {
                    self.out_buf.push(1.0);
                    self.out_buf.push(f64::from(cue_index));
                    self.out_buf.push(f64::from(kind));
                    self.out_buf.push(target_sec);
                }
                Event::Judged {
                    cue_index,
                    judgment,
                    error_ms,
                } => {
                    self.out_buf.push(2.0);
                    self.out_buf.push(f64::from(cue_index));
                    self.out_buf.push(f64::from(judgment as u8));
                    self.out_buf.push(error_ms);
                }
                Event::AutoMiss { cue_index } => {
                    self.out_buf.push(3.0);
                    self.out_buf.push(f64::from(cue_index));
                    self.out_buf.push(f64::from(Judgment::Miss as u8));
                    self.out_buf.push(0.0);
                }
            }
        }

        Float64Array::from(self.out_buf.as_slice())
    }

    /// 統計 JSON（docs/M0-SPEC.md §4 の形式）。
    #[wasm_bindgen(js_name = statsJson)]
    pub fn stats_json(&self) -> Result<String, JsError> {
        let stats = self.engine.stats();
        let json = serde_json::json!({
            "totalCues": stats.total_cues,
            "judged": stats.judged,
            "just": stats.just,
            "safe": stats.safe,
            "miss": stats.miss,
            "meanMs": stats.mean_ms,
            "stdMs": stats.std_ms,
            "histogram": {
                "fromMs": -100,
                "binMs": 10,
                "counts": stats.histogram,
            },
        });
        serde_json::to_string(&json)
            .map_err(|e| JsError::new(&format!("statsJson のシリアライズに失敗しました: {e}")))
    }

    /// 全キュー判定済み、または曲終了なら true。
    pub fn finished(&self, now_sec: f64) -> bool {
        self.engine.finished(now_sec)
    }
}
