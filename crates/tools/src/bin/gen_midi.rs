//! `gen_midi [--song <metronome|uraomote>] --out <path>`: 譜面 SMF を生成して書き出す。

use std::process::ExitCode;

/// 使い方（引数不足・未知の曲名で表示）。
const USAGE: &str = "usage: gen_midi [--song <metronome|uraomote>] --out <path>";

fn main() -> ExitCode {
    let (song, out) = match parse_args() {
        Some(v) => v,
        None => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    let data = match song.as_str() {
        "metronome" => tools::build_metronome_midi(),
        "uraomote" => tools::build_uraomote_midi(),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    if let Err(e) = std::fs::write(&out, &data) {
        eprintln!("書き込み失敗 {out}: {e}");
        return ExitCode::FAILURE;
    }

    println!("wrote {out} ({} bytes)", data.len());
    ExitCode::SUCCESS
}

/// `--song <name>`（省略時 metronome）と `--out <path>` を std::env::args のみで解析する。
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
