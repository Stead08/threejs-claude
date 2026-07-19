//! `gen_midi --out <path>`: メトロノーム譜面 SMF を生成して書き出す。

use std::process::ExitCode;

fn main() -> ExitCode {
    let out = match parse_out() {
        Some(path) => path,
        None => {
            eprintln!("usage: gen_midi --out <path>");
            return ExitCode::from(2);
        }
    };

    let data = tools::build_metronome_midi();
    if let Err(e) = std::fs::write(&out, &data) {
        eprintln!("書き込み失敗 {out}: {e}");
        return ExitCode::FAILURE;
    }

    println!("wrote {out} ({} bytes)", data.len());
    ExitCode::SUCCESS
}

/// `--out <path>` を std::env::args のみで解析する。
fn parse_out() -> Option<String> {
    let mut args = std::env::args().skip(1);
    let mut out: Option<String> = None;
    while let Some(arg) = args.next() {
        if arg == "--out" {
            out = args.next();
        }
    }
    out
}
