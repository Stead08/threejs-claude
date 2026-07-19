//! rhythm-synth — MIDI + SoundFont のオフラインレンダ（wasm 非依存の純 Rust）。
//!
//! docs/M0-SPEC.md §3 の実装契約に従う。
//! - [`render_midi`] : MIDI 全体を PCM にレンダ（指定トラック名の除外に対応）。
//! - [`render_note`] : 単発ノート（タップ SFX 用）。
//! - [`SongRenderer`] : チャンク駆動レンダ（ロード進捗表示用）。`render_midi` はこのラッパ。

use std::io::Cursor;
use std::sync::Arc;

use midly::{MetaMessage, Smf, TrackEvent, TrackEventKind};
use rustysynth::{MidiFile, MidiFileSequencer, SoundFont, Synthesizer, SynthesizerSettings};
use thiserror::Error;

/// レンダ結果（ステレオ f32 PCM）。
pub struct Rendered {
    /// サンプルレート（Hz）。
    pub sample_rate: u32,
    /// 左チャンネル。
    pub left: Vec<f32>,
    /// 右チャンネル。
    pub right: Vec<f32>,
}

/// シンセ処理のエラー。
#[derive(Debug, Error)]
pub enum SynthError {
    /// MIDI のパースに失敗。
    #[error("MIDI のパースに失敗しました: {0}")]
    MidiParse(String),
    /// MIDI の再シリアライズに失敗。
    #[error("MIDI の再シリアライズに失敗しました: {0}")]
    MidiWrite(String),
    /// rustysynth の MIDI ロードに失敗。
    #[error("MIDI ファイルのロードに失敗しました: {0}")]
    MidiLoad(String),
    /// SoundFont のロードに失敗。
    #[error("SoundFont のロードに失敗しました: {0}")]
    SoundFont(String),
    /// シンセサイザの初期化に失敗。
    #[error("シンセサイザの初期化に失敗しました: {0}")]
    Synth(String),
}

/// `exclude_track` に一致するトラック名メタを持つトラックを除去し、MIDI を再シリアライズする。
/// `None`（または一致トラックなし）の場合は入力をそのまま返す。
fn strip_track(midi: &[u8], exclude_track: Option<&str>) -> Result<Vec<u8>, SynthError> {
    let exclude = match exclude_track {
        Some(name) => name,
        None => return Ok(midi.to_vec()),
    };

    let smf = Smf::parse(midi).map_err(|e| SynthError::MidiParse(e.to_string()))?;

    let mut out = Smf::new(smf.header);
    for track in &smf.tracks {
        if track_name_matches(track, exclude) {
            continue;
        }
        out.tracks.push(track.clone());
    }

    let mut buf = Vec::new();
    out.write_std(&mut buf)
        .map_err(|e| SynthError::MidiWrite(e.to_string()))?;
    Ok(buf)
}

/// トラックが指定名の TrackName メタを含むか。
fn track_name_matches(track: &[TrackEvent], name: &str) -> bool {
    track.iter().any(|ev| {
        matches!(ev.kind, TrackEventKind::Meta(MetaMessage::TrackName(bytes)) if bytes == name.as_bytes())
    })
}

fn load_sound_font(sf2: &[u8]) -> Result<Arc<SoundFont>, SynthError> {
    let sound_font =
        SoundFont::new(&mut Cursor::new(sf2)).map_err(|e| SynthError::SoundFont(e.to_string()))?;
    Ok(Arc::new(sound_font))
}

fn new_synthesizer(
    sound_font: &Arc<SoundFont>,
    sample_rate: u32,
) -> Result<Synthesizer, SynthError> {
    let settings = SynthesizerSettings::new(sample_rate as i32);
    Synthesizer::new(sound_font, &settings).map_err(|e| SynthError::Synth(e.to_string()))
}

/// MIDI + SoundFont を PCM にレンダする。`exclude_track` が指定されればそのトラック名メタを
/// 持つトラックを除去してからレンダする。内部的には [`SongRenderer`] のチャンク駆動を回すラッパ。
pub fn render_midi(
    midi: &[u8],
    sf2: &[u8],
    sample_rate: u32,
    exclude_track: Option<&str>,
) -> Result<Rendered, SynthError> {
    let mut renderer = SongRenderer::new(midi, sf2, sample_rate, exclude_track)?;
    // 1 秒ぶんずつレンダして完了まで回す。
    let chunk = sample_rate.max(1) as usize;
    while !renderer.render_chunk(chunk) {}
    Ok(renderer.into_rendered())
}

/// 単発ノートをレンダする（タップ SFX 用）。
/// `percussion=true` ならチャンネル 9（rustysynth が bank128 を自動選択）、
/// `false` ならチャンネル 0 に program change してからレンダする。
///
/// フロー: note_on → `duration_sec` レンダ → note_off → 0.5 秒テイルレンダ。
pub fn render_note(
    sf2: &[u8],
    percussion: bool,
    preset: u8,
    key: u8,
    velocity: u8,
    duration_sec: f64,
    sample_rate: u32,
) -> Result<Rendered, SynthError> {
    let sound_font = load_sound_font(sf2)?;
    let mut synth = new_synthesizer(&sound_font, sample_rate)?;

    let channel: i32 = if percussion { 9 } else { 0 };
    // Program Change（0xC0）でプリセットを明示選択する。ch9 でも bank128 内の
    // パッチ選択として機能する（省略すると preset 引数が無視され、bank128:preset0 に
    // 固定されてしまう — 現状 preset=0 のみだが契約どおり常に反映する）。
    synth.process_midi_message(channel, 0xC0, preset as i32, 0);

    let dur_frames = (duration_sec * sample_rate as f64).round().max(0.0) as usize;
    let tail_frames = (0.5 * sample_rate as f64).round() as usize;
    let total = dur_frames + tail_frames;

    let mut left = vec![0.0_f32; total];
    let mut right = vec![0.0_f32; total];

    synth.note_on(channel, key as i32, velocity as i32);
    synth.render(&mut left[..dur_frames], &mut right[..dur_frames]);
    synth.note_off(channel, key as i32);
    synth.render(&mut left[dur_frames..], &mut right[dur_frames..]);

    Ok(Rendered {
        sample_rate,
        left,
        right,
    })
}

/// チャンク駆動のソングレンダラ。`total_frames` は「曲長 + テイル 1 秒」ぶんのフレーム数。
pub struct SongRenderer {
    sequencer: MidiFileSequencer,
    sample_rate: u32,
    total_frames: usize,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl SongRenderer {
    /// レンダラを初期化する。`exclude_track` が指定されればそのトラックを除去する。
    pub fn new(
        midi: &[u8],
        sf2: &[u8],
        sample_rate: u32,
        exclude_track: Option<&str>,
    ) -> Result<Self, SynthError> {
        let midi_bytes = strip_track(midi, exclude_track)?;

        let sound_font = load_sound_font(sf2)?;
        let synthesizer = new_synthesizer(&sound_font, sample_rate)?;

        let midi_file = MidiFile::new(&mut Cursor::new(midi_bytes.as_slice()))
            .map_err(|e| SynthError::MidiLoad(e.to_string()))?;
        let midi_file = Arc::new(midi_file);

        let mut sequencer = MidiFileSequencer::new(synthesizer);
        sequencer.play(&midi_file, false);

        // 曲長（秒）+ 1 秒テイル。
        let length_sec = midi_file.get_length();
        let total_frames = ((length_sec + 1.0) * sample_rate as f64).round() as usize;

        Ok(Self {
            sequencer,
            sample_rate,
            total_frames,
            left: Vec::with_capacity(total_frames),
            right: Vec::with_capacity(total_frames),
        })
    }

    /// レンダ対象の総フレーム数（曲長 + テイル 1 秒）。
    pub fn total_frames(&self) -> usize {
        self.total_frames
    }

    /// これまでにレンダ済みのフレーム数。
    pub fn rendered_frames(&self) -> usize {
        self.left.len()
    }

    /// 最大 `max_frames` フレームだけレンダして内部バッファへ追記する。完了で `true`。
    pub fn render_chunk(&mut self, max_frames: usize) -> bool {
        let remaining = self.total_frames.saturating_sub(self.left.len());
        let n = remaining.min(max_frames);
        if n > 0 {
            let start = self.left.len();
            self.left.resize(start + n, 0.0);
            self.right.resize(start + n, 0.0);
            self.sequencer
                .render(&mut self.left[start..], &mut self.right[start..]);
        }
        self.left.len() >= self.total_frames
    }

    /// レンダ結果を取り出す。
    pub fn into_rendered(self) -> Rendered {
        Rendered {
            sample_rate: self.sample_rate,
            left: self.left,
            right: self.right,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 生成済みアセットは CARGO_MANIFEST_DIR 相対（../../charts/）で読む。
    const MIDI_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../charts/metronome.mid");
    const SF2_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../charts/dev.sf2");
    // テストは軽量化のため 22.05kHz でレンダする（>= 16000 で有効）。
    const SR: u32 = 22_050;

    fn read_assets() -> (Vec<u8>, Vec<u8>) {
        let midi = std::fs::read(MIDI_PATH)
            .unwrap_or_else(|e| panic!("{MIDI_PATH} を読めません（先に gen_midi を実行）: {e}"));
        let sf2 = std::fs::read(SF2_PATH)
            .unwrap_or_else(|e| panic!("{SF2_PATH} を読めません（先に gen_sf2 を実行）: {e}"));
        (midi, sf2)
    }

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0_f32, |m, &x| m.max(x.abs()))
    }

    #[test]
    fn render_midi_is_non_silent() {
        let (midi, sf2) = read_assets();
        let out = render_midi(&midi, &sf2, SR, Some("CUES")).expect("render_midi 失敗");
        assert!(
            peak(&out.left) > 0.05 && peak(&out.right) > 0.05,
            "レンダ結果が無音: L={} R={}",
            peak(&out.left),
            peak(&out.right)
        );
    }

    #[test]
    fn render_length_matches_total_frames() {
        let (midi, sf2) = read_assets();
        let expected = SongRenderer::new(&midi, &sf2, SR, Some("CUES"))
            .expect("SongRenderer::new 失敗")
            .total_frames();
        let out = render_midi(&midi, &sf2, SR, Some("CUES")).expect("render_midi 失敗");
        assert_eq!(
            out.left.len(),
            expected,
            "左チャンネル長が total_frames と不一致"
        );
        assert_eq!(
            out.right.len(),
            expected,
            "右チャンネル長が total_frames と不一致"
        );
        // 曲長 ≈ 128 秒 + テイル 1 秒 → total_frames ≈ 129 * SR。
        let approx = (129.0 * SR as f64) as usize;
        let diff = expected.abs_diff(approx);
        assert!(
            diff < SR as usize,
            "total_frames が想定と乖離: {expected} vs {approx}"
        );
    }

    #[test]
    fn exclude_track_changes_waveform() {
        let (midi, sf2) = read_assets();
        // 全体レンダは重いので一部フレームだけ比較する。CUES ノートはカウントイン
        // 2 小節（4.0 秒 @120BPM）の後から始まるため、4〜6 秒の窓で差異を検出する。
        let cmp_start = SR as usize * 4;
        let cmp_end = SR as usize * 6;

        let mut with_cues = SongRenderer::new(&midi, &sf2, SR, None).expect("new 失敗");
        while with_cues.rendered_frames() < cmp_end && !with_cues.render_chunk(SR as usize) {}
        let a = with_cues.into_rendered();

        let mut without_cues = SongRenderer::new(&midi, &sf2, SR, Some("CUES")).expect("new 失敗");
        while without_cues.rendered_frames() < cmp_end && !without_cues.render_chunk(SR as usize) {}
        let b = without_cues.into_rendered();

        let n = cmp_end.min(a.left.len()).min(b.left.len());
        assert!(n > cmp_start, "比較窓ぶんのフレームがレンダされていない");
        let differs = a.left[cmp_start..n]
            .iter()
            .zip(&b.left[cmp_start..n])
            .any(|(x, y)| (x - y).abs() > 1e-6);
        assert!(
            differs,
            "CUES 除外の有無で波形が変化しない（除外処理が効いていない）"
        );

        // カウントイン区間（CUES ノートなし）は除外の有無で完全一致するはず。
        let same_head = a.left[..cmp_start]
            .iter()
            .zip(&b.left[..cmp_start])
            .all(|(x, y)| (x - y).abs() <= 1e-6);
        assert!(same_head, "カウントイン区間の波形が除外の有無で一致しない");
    }

    #[test]
    fn render_note_is_non_silent() {
        let (_midi, sf2) = read_assets();
        for key in [36_u8, 37, 38] {
            let out = render_note(&sf2, true, 0, key, 120, 0.3, 44_100).expect("render_note 失敗");
            let p = peak(&out.left).max(peak(&out.right));
            assert!(p > 0.05, "key {key} が無音: peak={p}");
        }
    }

    #[test]
    fn chunk_driven_matches_render_midi() {
        let (midi, sf2) = read_assets();
        let whole = render_midi(&midi, &sf2, SR, Some("CUES")).expect("render_midi 失敗");

        // 異なるチャンクサイズで駆動しても同一出力になること。
        let mut r = SongRenderer::new(&midi, &sf2, SR, Some("CUES")).expect("new 失敗");
        while !r.render_chunk(10_000) {}
        let chunked = r.into_rendered();

        assert_eq!(
            whole.left.len(),
            chunked.left.len(),
            "左チャンネル長が不一致"
        );
        assert_eq!(
            whole.right.len(),
            chunked.right.len(),
            "右チャンネル長が不一致"
        );
        // 決定論的なので完全一致するはず。float の == を避けてビット列で比較する。
        let left_same = whole
            .left
            .iter()
            .map(|x| x.to_bits())
            .eq(chunked.left.iter().map(|x| x.to_bits()));
        let right_same = whole
            .right
            .iter()
            .map(|x| x.to_bits())
            .eq(chunked.right.iter().map(|x| x.to_bits()));
        assert!(left_same, "左チャンネルの波形が不一致");
        assert!(right_same, "右チャンネルの波形が不一致");
    }
}
