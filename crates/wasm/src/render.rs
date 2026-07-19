//! `rhythm-synth` のレンダ機能（単発ノート・チャンク駆動の曲レンダ）を wasm へ橋渡しする。

use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

use rhythm_synth::Rendered;

/// レンダ結果（ステレオ f32 PCM）。JS へは getter で copy 返却する。
#[wasm_bindgen]
pub struct RenderResult {
    sample_rate: u32,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl From<Rendered> for RenderResult {
    fn from(r: Rendered) -> Self {
        RenderResult {
            sample_rate: r.sample_rate,
            left: r.left,
            right: r.right,
        }
    }
}

#[wasm_bindgen]
impl RenderResult {
    /// サンプルレート（Hz）。
    #[wasm_bindgen(getter = sampleRate)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// 左チャンネル（copy 返却）。
    #[wasm_bindgen(getter)]
    pub fn left(&self) -> Float32Array {
        Float32Array::from(self.left.as_slice())
    }

    /// 右チャンネル（copy 返却）。
    #[wasm_bindgen(getter)]
    pub fn right(&self) -> Float32Array {
        Float32Array::from(self.right.as_slice())
    }
}

/// 単発ノートをレンダする（タップ SFX 用）。`percussion=true` ならチャンネル 9（bank128）を使用する。
#[wasm_bindgen(js_name = renderNote)]
pub fn render_note(
    sf2: &[u8],
    percussion: bool,
    preset: u8,
    key: u8,
    velocity: u8,
    duration_sec: f64,
    sample_rate: u32,
) -> Result<RenderResult, JsError> {
    let rendered = rhythm_synth::render_note(
        sf2,
        percussion,
        preset,
        key,
        velocity,
        duration_sec,
        sample_rate,
    )
    .map_err(|e| {
        JsError::new(&format!(
            "renderNote に失敗しました (percussion={percussion}, preset={preset}, key={key}): {e}"
        ))
    })?;
    Ok(rendered.into())
}

/// チャンク駆動の曲レンダラ。ロード進捗表示用に `renderChunk` を繰り返し呼び出せる。
///
/// `take()` は自身を消費せず `&mut self` + 内部 `Option::take` で実装する
/// （wasm-bindgen の self 制約回避）。消費後に再度呼ぶと [`JsError`] を返す。
#[wasm_bindgen]
pub struct SongRenderer {
    inner: Option<rhythm_synth::SongRenderer>,
}

impl SongRenderer {
    fn inner_ref(&self) -> Result<&rhythm_synth::SongRenderer, JsError> {
        self.inner
            .as_ref()
            .ok_or_else(|| JsError::new("SongRenderer は既に take() 済みです"))
    }

    fn inner_mut(&mut self) -> Result<&mut rhythm_synth::SongRenderer, JsError> {
        self.inner
            .as_mut()
            .ok_or_else(|| JsError::new("SongRenderer は既に take() 済みです"))
    }
}

#[wasm_bindgen]
impl SongRenderer {
    /// `excludeTrack` が指定されればそのトラック名メタを持つトラックを除去してからレンダする。
    #[wasm_bindgen(constructor)]
    pub fn new(
        midi: &[u8],
        sf2: &[u8],
        sample_rate: u32,
        exclude_track: Option<String>,
    ) -> Result<SongRenderer, JsError> {
        let renderer =
            rhythm_synth::SongRenderer::new(midi, sf2, sample_rate, exclude_track.as_deref())
                .map_err(|e| JsError::new(&format!("SongRenderer の初期化に失敗しました: {e}")))?;
        Ok(SongRenderer {
            inner: Some(renderer),
        })
    }

    /// レンダ対象の総フレーム数（曲長 + テイル 1 秒）。
    #[wasm_bindgen(js_name = totalFrames)]
    pub fn total_frames(&self) -> Result<u32, JsError> {
        Ok(self.inner_ref()?.total_frames() as u32)
    }

    /// これまでにレンダ済みのフレーム数。
    #[wasm_bindgen(js_name = renderedFrames)]
    pub fn rendered_frames(&self) -> Result<u32, JsError> {
        Ok(self.inner_ref()?.rendered_frames() as u32)
    }

    /// 最大 `maxFrames` フレームだけレンダする。完了で `true`。
    #[wasm_bindgen(js_name = renderChunk)]
    pub fn render_chunk(&mut self, max_frames: u32) -> Result<bool, JsError> {
        Ok(self.inner_mut()?.render_chunk(max_frames as usize))
    }

    /// レンダ結果を取り出す（1 回限り）。
    pub fn take(&mut self) -> Result<RenderResult, JsError> {
        let renderer = self
            .inner
            .take()
            .ok_or_else(|| JsError::new("SongRenderer は既に take() 済みです"))?;
        Ok(renderer.into_rendered().into())
    }
}
