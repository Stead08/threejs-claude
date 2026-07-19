//! 生成済みアセット（charts/metronome.mid + charts/dev.sf2）を試聴用 WAV へレンダする。
//!
//! 使い方: `cargo run -p rhythm-synth --example render_wav -- <out.wav> [--with-cues]`
//! 既定ではゲーム再生と同じく CUES トラックを除外してレンダする。

use std::env;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::process::ExitCode;

const MIDI_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../charts/metronome.mid");
const SF2_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../charts/dev.sf2");
const SAMPLE_RATE: u32 = 44_100;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let out_path = match args.first() {
        Some(p) if !p.starts_with("--") => p.clone(),
        _ => {
            eprintln!("usage: render_wav <out.wav> [--with-cues]");
            return ExitCode::from(2);
        }
    };
    let with_cues = args.iter().any(|a| a == "--with-cues");
    let exclude = if with_cues { None } else { Some("CUES") };

    let midi = match std::fs::read(MIDI_PATH) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{MIDI_PATH} を読めません（先に gen_midi を実行）: {e}");
            return ExitCode::FAILURE;
        }
    };
    let sf2 = match std::fs::read(SF2_PATH) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{SF2_PATH} を読めません（先に gen_sf2 を実行）: {e}");
            return ExitCode::FAILURE;
        }
    };

    let rendered = match rhythm_synth::render_midi(&midi, &sf2, SAMPLE_RATE, exclude) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("レンダに失敗しました: {e}");
            return ExitCode::FAILURE;
        }
    };

    if let Err(e) = write_wav(&out_path, &rendered.left, &rendered.right, SAMPLE_RATE) {
        eprintln!("WAV の書き込みに失敗しました {out_path}: {e}");
        return ExitCode::FAILURE;
    }

    let secs = rendered.left.len() as f64 / f64::from(SAMPLE_RATE);
    let peak = rendered
        .left
        .iter()
        .chain(rendered.right.iter())
        .fold(0.0_f32, |m, &x| m.max(x.abs()));
    println!("wrote {out_path} ({secs:.1}s, peak {peak:.3})");
    ExitCode::SUCCESS
}

/// 16bit ステレオ PCM の WAV を書き出す（std のみ）。
fn write_wav(path: &str, left: &[f32], right: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let frames = left.len().min(right.len());
    let data_len = (frames * 4) as u32; // 2ch × 16bit
    let mut w = BufWriter::new(File::create(path)?);

    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_len).to_le_bytes())?;
    w.write_all(b"WAVE")?;
    w.write_all(b"fmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?; // PCM
    w.write_all(&2u16.to_le_bytes())?; // stereo
    w.write_all(&sample_rate.to_le_bytes())?;
    w.write_all(&(sample_rate * 4).to_le_bytes())?; // byte rate
    w.write_all(&4u16.to_le_bytes())?; // block align
    w.write_all(&16u16.to_le_bytes())?; // bits per sample
    w.write_all(b"data")?;
    w.write_all(&data_len.to_le_bytes())?;

    for i in 0..frames {
        for ch in [left, right] {
            let v = (ch[i].clamp(-1.0, 1.0) * 32767.0) as i16;
            w.write_all(&v.to_le_bytes())?;
        }
    }
    w.flush()
}
