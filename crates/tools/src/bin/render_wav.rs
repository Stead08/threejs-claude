//! `render_wav [--song <metronome|uraomote>] --out <path.wav>`: 作曲確認用の開発ツール。
//!
//! SMF と開発用 SF2 をメモリ上で生成し、判定用 CUES トラックを除外して
//! 44.1kHz / 16bit ステレオ WAV に書き出す。

use std::process::ExitCode;

/// レンダのサンプルレート（Hz）。
const SAMPLE_RATE: u32 = 44_100;

/// 使い方（引数不足・未知の曲名で表示）。
const USAGE: &str = "usage: render_wav [--song <metronome|uraomote>] --out <path.wav>";

fn main() -> ExitCode {
    let (song, out) = match parse_args() {
        Some(v) => v,
        None => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    let midi = match song.as_str() {
        "metronome" => tools::build_metronome_midi(),
        "uraomote" => tools::build_uraomote_midi(),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    let sf2 = tools::build_dev_sf2();

    let rendered = match rhythm_synth::render_midi(&midi, &sf2, SAMPLE_RATE, Some("CUES")) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("レンダ失敗: {e}");
            return ExitCode::FAILURE;
        }
    };

    let wav = encode_wav_16bit_stereo(&rendered);
    if let Err(e) = std::fs::write(&out, &wav) {
        eprintln!("書き込み失敗 {out}: {e}");
        return ExitCode::FAILURE;
    }

    let secs = rendered.left.len() as f64 / f64::from(SAMPLE_RATE);
    println!("wrote {out} ({} bytes, {secs:.1}s)", wav.len());
    ExitCode::SUCCESS
}

/// `--song <name>`（省略時 metronome）と `--out <path.wav>` を std::env::args のみで解析する。
fn parse_args() -> Option<(String, String)> {
    let mut args = std::env::args().skip(1);
    let mut song = String::from("metronome");
    let mut out: Option<String> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--song" => song = args.next()?,
            "--out" => out = args.next(),
            _ => {}
        }
    }
    Some((song, out?))
}

/// ステレオ f32 PCM を 16bit PCM WAV（44 バイトヘッダ手書き）へエンコードする。
fn encode_wav_16bit_stereo(r: &rhythm_synth::Rendered) -> Vec<u8> {
    let frames = r.left.len().min(r.right.len());
    let data_len = (frames * 4) as u32; // 2ch × 16bit

    let mut buf = Vec::with_capacity(44 + data_len as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // fmt チャンク長
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&2u16.to_le_bytes()); // ステレオ
    buf.extend_from_slice(&r.sample_rate.to_le_bytes());
    buf.extend_from_slice(&(r.sample_rate * 4).to_le_bytes()); // バイトレート
    buf.extend_from_slice(&4u16.to_le_bytes()); // ブロックアライン
    buf.extend_from_slice(&16u16.to_le_bytes()); // ビット深度
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    for (left, right) in r.left[..frames].iter().zip(&r.right[..frames]) {
        buf.extend_from_slice(&to_i16(*left).to_le_bytes());
        buf.extend_from_slice(&to_i16(*right).to_le_bytes());
    }
    buf
}

/// f32 サンプルを ±32767 でクランプして i16 化する。
fn to_i16(x: f32) -> i16 {
    (x * 32767.0).clamp(-32767.0, 32767.0) as i16
}
