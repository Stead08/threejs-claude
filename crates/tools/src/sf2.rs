//! 最小 SF2（SoundFont 2.01）の手書き生成。docs/M0-SPEC.md §1.3。std のみに依存。
//!
//! 生成物の構成:
//! - INFO: ifil(2.1) / isng("EMU8000") / INAM
//! - sdta: smpl（int16 PCM 連結、各サンプル末尾に 46 サンプルのゼロガード）
//! - pdta: phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr（各終端レコードつき）
//!
//! プリセット:
//! - bank0 preset0 "Lead"     → SquareInst（単サイクル矩形波をループ再生）
//! - bank128 preset0 "Percussion" → PercInst（key35=kick / key36=low / key37=click /
//!   key38=accent / key39=clap / key42=chat / key46=ohat）
//! - bank0 preset1 "Bass"     → TriInst（単サイクル三角波をループ再生）
//! - bank0 preset2 "Chime"    → SineInst（単サイクル正弦波をループ再生）

use std::f32::consts::TAU;

/// サンプルレート（Hz）。
const SAMPLE_RATE: u32 = 44_100;
/// 各サンプル末尾のゼロガード数（>= 46 を満たす）。
const GUARD: usize = 46;
/// shdr の original_pitch。
const ROOT_KEY: u8 = 60;
/// ループ音色の overridingRootKey。単サイクル 100 サンプル @44.1kHz = 441Hz ≈ A4(key69)
/// なので、69 を指定すると記譜どおりの音高で鳴る。
const LOOP_ROOT_KEY: u16 = 69;

// ------- SF2 ジェネレータ種別 -------
const GEN_KEY_RANGE: u16 = 43;
const GEN_INSTRUMENT: u16 = 41;
const GEN_SAMPLE_ID: u16 = 53;
const GEN_SAMPLE_MODES: u16 = 54;
const GEN_OVERRIDING_ROOT_KEY: u16 = 58;

/// (ジェネレータ種別, 値) の列 = 1 ゾーン。
type Zone = Vec<(u16, u16)>;
/// プリセット定義: (名前, bank, patch, ゾーン列)。
type PresetDef = (&'static str, u16, u16, Vec<Zone>);
/// インストゥルメント定義: (名前, ゾーン列)。
type InstrumentDef = (&'static str, Vec<Zone>);

/// smpl 内に配置したサンプル 1 個ぶんのヘッダ情報。
struct SampleSpec {
    name: &'static str,
    start: u32,
    end: u32,
    start_loop: u32,
    end_loop: u32,
    original_pitch: u8,
}

/// 開発用 SF2 バイナリを生成して返す（目標 < 160KB）。
pub fn build_dev_sf2() -> Vec<u8> {
    let (wave, specs) = build_samples();

    // サンプル ID（specs の並び順）。
    const CLICK: u16 = 0;
    const LOW: u16 = 1;
    const ACCENT: u16 = 2;
    const SQUARE: u16 = 3;
    const TRIANGLE: u16 = 4;
    const SINEW: u16 = 5;
    const KICK: u16 = 6;
    const CLAP: u16 = 7;
    const CHAT: u16 = 8;
    const OHAT: u16 = 9;

    // ---- インストゥルメント定義（keyRange 先頭、sampleModes/overridingRootKey 中間、sampleID 末尾）----
    let instruments: [InstrumentDef; 4] = [
        (
            "SquareInst",
            vec![vec![
                (GEN_KEY_RANGE, key_range(0, 127)),
                (GEN_SAMPLE_MODES, 1), // Continuous loop
                (GEN_OVERRIDING_ROOT_KEY, LOOP_ROOT_KEY),
                (GEN_SAMPLE_ID, SQUARE),
            ]],
        ),
        (
            "PercInst",
            vec![
                perc_zone(35, KICK),
                perc_zone(36, LOW),
                perc_zone(37, CLICK),
                perc_zone(38, ACCENT),
                perc_zone(39, CLAP),
                perc_zone(42, CHAT),
                perc_zone(46, OHAT),
            ],
        ),
        (
            "TriInst",
            vec![vec![
                (GEN_KEY_RANGE, key_range(0, 127)),
                (GEN_SAMPLE_MODES, 1), // Continuous loop
                (GEN_OVERRIDING_ROOT_KEY, LOOP_ROOT_KEY),
                (GEN_SAMPLE_ID, TRIANGLE),
            ]],
        ),
        (
            "SineInst",
            vec![vec![
                (GEN_KEY_RANGE, key_range(0, 127)),
                (GEN_SAMPLE_MODES, 1), // Continuous loop
                (GEN_OVERRIDING_ROOT_KEY, LOOP_ROOT_KEY),
                (GEN_SAMPLE_ID, SINEW),
            ]],
        ),
    ];

    // ---- プリセット定義（zone の末尾は instrument ジェネレータ）----
    let presets: [PresetDef; 4] = [
        ("Lead", 0, 0, vec![vec![(GEN_INSTRUMENT, 0)]]),
        ("Percussion", 128, 0, vec![vec![(GEN_INSTRUMENT, 1)]]),
        ("Bass", 0, 1, vec![vec![(GEN_INSTRUMENT, 2)]]),
        ("Chime", 0, 2, vec![vec![(GEN_INSTRUMENT, 3)]]),
    ];

    let (phdr, pbag, pgen) = build_preset_chunks(&presets);
    let (inst, ibag, igen) = build_instrument_chunks(&instruments);
    let shdr = build_shdr(&specs);
    // 終端レコードのみのモジュレータ（rustysynth では discard されるが SF2 仕様に従い配置）。
    let term_mod = vec![0u8; 10];

    // ---- INFO ----
    let mut info = Vec::new();
    {
        let mut ifil = Vec::with_capacity(4);
        write_u16(&mut ifil, 2); // major
        write_u16(&mut ifil, 1); // minor
        info.extend(chunk(b"ifil", &ifil));
    }
    info.extend(chunk(b"isng", &even_cstr("EMU8000")));
    info.extend(chunk(b"INAM", &even_cstr("M0 Dev SF2")));
    let info_list = list_chunk(b"INFO", &info);

    // ---- sdta ----
    let mut smpl = Vec::with_capacity(wave.len() * 2);
    for s in &wave {
        smpl.extend_from_slice(&s.to_le_bytes());
    }
    let sdta_list = list_chunk(b"sdta", &chunk(b"smpl", &smpl));

    // ---- pdta ----
    let mut pdta = Vec::new();
    pdta.extend(chunk(b"phdr", &phdr));
    pdta.extend(chunk(b"pbag", &pbag));
    pdta.extend(chunk(b"pmod", &term_mod));
    pdta.extend(chunk(b"pgen", &pgen));
    pdta.extend(chunk(b"inst", &inst));
    pdta.extend(chunk(b"ibag", &ibag));
    pdta.extend(chunk(b"imod", &term_mod));
    pdta.extend(chunk(b"igen", &igen));
    pdta.extend(chunk(b"shdr", &shdr));
    let pdta_list = list_chunk(b"pdta", &pdta);

    // ---- RIFF sfbk ----
    let mut body = Vec::new();
    body.extend_from_slice(b"sfbk");
    body.extend(info_list);
    body.extend(sdta_list);
    body.extend(pdta_list);
    chunk(b"RIFF", &body)
}

/// keyRange のジェネレータ値（lo | hi<<8）。
fn key_range(lo: u8, hi: u8) -> u16 {
    ((hi as u16) << 8) | (lo as u16)
}

/// パーカッションのゾーン（keyRange=key-key, sampleModes=0, overridingRootKey=key, sampleID）。
fn perc_zone(key: u8, sample_id: u16) -> Vec<(u16, u16)> {
    vec![
        (GEN_KEY_RANGE, key_range(key, key)),
        (GEN_SAMPLE_MODES, 0),
        (GEN_OVERRIDING_ROOT_KEY, key as u16),
        (GEN_SAMPLE_ID, sample_id),
    ]
}

/// 全サンプルの PCM を smpl バッファに連結し、shdr 情報を返す。
fn build_samples() -> (Vec<i16>, Vec<SampleSpec>) {
    let mut wave: Vec<i16> = Vec::new();
    let mut specs: Vec<SampleSpec> = Vec::new();

    // 並び順は SampleSpec のインデックスと一致させる
    // （click, low, accent, square, triangle, sinew, kick, clap, chat, ohat）。
    append_sample(
        &mut wave,
        &mut specs,
        "click",
        &decaying_sine(1900.0, 0.10, 0.7, 40.0),
    );
    append_sample(
        &mut wave,
        &mut specs,
        "low",
        &decaying_sine(800.0, 0.12, 0.7, 35.0),
    );
    append_sample(
        &mut wave,
        &mut specs,
        "accent",
        &decaying_sine(2400.0, 0.09, 0.9, 50.0),
    );
    // 単サイクル波形（ループ用）。各サンプル末尾のゼロガードにより endloop < 次の start が保たれる。
    append_sample(&mut wave, &mut specs, "square", &square_cycle(100, 0.5));
    append_sample(&mut wave, &mut specs, "triangle", &triangle_cycle(100, 0.8));
    append_sample(&mut wave, &mut specs, "sinew", &sine_cycle(100, 0.8));
    // パーカッション（ワンショット）。
    append_sample(
        &mut wave,
        &mut specs,
        "kick",
        &kick_wave(110.0, 45.0, 0.05, 0.2, 0.95, 16.0),
    );
    append_sample(
        &mut wave,
        &mut specs,
        "clap",
        &decaying_noise(0.12, 0.8, 28.0, 1),
    );
    append_sample(
        &mut wave,
        &mut specs,
        "chat",
        &decaying_noise(0.04, 0.6, 90.0, 2),
    );
    append_sample(
        &mut wave,
        &mut specs,
        "ohat",
        &decaying_noise(0.2, 0.5, 14.0, 3),
    );

    (wave, specs)
}

/// PCM をゼロガードつきで連結し、SampleSpec を積む。
/// ループ点はサンプル全域（start..end）。ループの有無はインストゥルメント側の
/// sampleModes ジェネレータで制御するため、shdr のループ点は常に全域で整合させる。
fn append_sample(
    wave: &mut Vec<i16>,
    specs: &mut Vec<SampleSpec>,
    name: &'static str,
    pcm: &[i16],
) {
    let start = wave.len() as u32;
    wave.extend_from_slice(pcm);
    let end = wave.len() as u32;
    // 末尾ゼロガード。
    wave.resize(wave.len() + GUARD, 0);

    specs.push(SampleSpec {
        name,
        start,
        end,
        start_loop: start,
        end_loop: end,
        original_pitch: ROOT_KEY,
    });
}

/// 減衰サインバースト。`decay` は減衰レート（1/秒）。
fn decaying_sine(freq: f32, dur_sec: f32, amp: f32, decay: f32) -> Vec<i16> {
    let n = (dur_sec * SAMPLE_RATE as f32) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let t = i as f32 / SAMPLE_RATE as f32;
        let env = (-t * decay).exp();
        let s = amp * env * (TAU * freq * t).sin();
        out.push(to_i16(s));
    }
    out
}

/// 単サイクル矩形波（前半 +amp / 後半 -amp）。
fn square_cycle(len: usize, amp: f32) -> Vec<i16> {
    let half = len / 2;
    let hi = to_i16(amp);
    let lo = to_i16(-amp);
    (0..len).map(|i| if i < half { hi } else { lo }).collect()
}

/// 単サイクル三角波（0 → +amp → -amp → 0）。
fn triangle_cycle(len: usize, amp: f32) -> Vec<i16> {
    (0..len)
        .map(|i| {
            let p = i as f32 / len as f32;
            let v = if p < 0.25 {
                4.0 * p
            } else if p < 0.75 {
                2.0 - 4.0 * p
            } else {
                4.0 * p - 4.0
            };
            to_i16(amp * v)
        })
        .collect()
}

/// 単サイクル正弦波。
fn sine_cycle(len: usize, amp: f32) -> Vec<i16> {
    (0..len)
        .map(|i| to_i16(amp * (TAU * i as f32 / len as f32).sin()))
        .collect()
}

/// キック用の減衰サイン。周波数を最初の `sweep_sec` で `f0`→`f1` に指数的に降下させ、
/// 以降は `f1` で一定。位相は瞬時周波数の積分で連続に保つ。
fn kick_wave(f0: f32, f1: f32, sweep_sec: f32, dur_sec: f32, amp: f32, decay: f32) -> Vec<i16> {
    let n = (dur_sec * SAMPLE_RATE as f32) as usize;
    let dt = 1.0 / SAMPLE_RATE as f32;
    let mut out = Vec::with_capacity(n);
    let mut phase = 0.0_f32;
    for i in 0..n {
        let t = i as f32 * dt;
        let freq = if t < sweep_sec {
            f0 * (f1 / f0).powf(t / sweep_sec)
        } else {
            f1
        };
        let env = (-t * decay).exp();
        out.push(to_i16(amp * env * phase.sin()));
        phase += TAU * freq * dt;
    }
    out
}

/// 減衰ノイズバースト。決定論的 LCG（Numerical Recipes 定数）で再現可能にする。
fn decaying_noise(dur_sec: f32, amp: f32, decay: f32, seed: u32) -> Vec<i16> {
    let n = (dur_sec * SAMPLE_RATE as f32) as usize;
    let mut out = Vec::with_capacity(n);
    let mut x = seed;
    for i in 0..n {
        x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        // u32 → [-1, 1]
        let noise = (x as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let t = i as f32 / SAMPLE_RATE as f32;
        let env = (-t * decay).exp();
        out.push(to_i16(amp * env * noise));
    }
    out
}

fn to_i16(v: f32) -> i16 {
    (v * 32767.0).clamp(-32768.0, 32767.0) as i16
}

/// phdr / pbag / pgen を組み立てる。
fn build_preset_chunks(presets: &[PresetDef]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut phdr = Vec::new();
    let mut pbag = Vec::new();
    let mut pgen = Vec::new();

    let mut gen_index: u16 = 0;
    let mut zone_index: u16 = 0;

    for (name, bank, patch, zones) in presets {
        // phdr: name(20), patch(u16), bank(u16), wPresetBagNdx(u16), library/genre/morphology(i32×3)
        phdr.extend(name20(name));
        write_u16(&mut phdr, *patch);
        write_u16(&mut phdr, *bank);
        write_u16(&mut phdr, zone_index);
        write_u32(&mut phdr, 0);
        write_u32(&mut phdr, 0);
        write_u32(&mut phdr, 0);

        for zone in zones {
            write_u16(&mut pbag, gen_index);
            write_u16(&mut pbag, 0);
            for (t, v) in zone {
                write_u16(&mut pgen, *t);
                write_u16(&mut pgen, *v);
                gen_index += 1;
            }
            zone_index += 1;
        }
    }

    // 終端 phdr（EOP）。
    phdr.extend(name20("EOP"));
    write_u16(&mut phdr, 0);
    write_u16(&mut phdr, 0);
    write_u16(&mut phdr, zone_index);
    write_u32(&mut phdr, 0);
    write_u32(&mut phdr, 0);
    write_u32(&mut phdr, 0);
    // 終端 pbag / pgen。
    write_u16(&mut pbag, gen_index);
    write_u16(&mut pbag, 0);
    write_u16(&mut pgen, 0);
    write_u16(&mut pgen, 0);

    (phdr, pbag, pgen)
}

/// inst / ibag / igen を組み立てる。
fn build_instrument_chunks(instruments: &[InstrumentDef]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut inst = Vec::new();
    let mut ibag = Vec::new();
    let mut igen = Vec::new();

    let mut gen_index: u16 = 0;
    let mut zone_index: u16 = 0;

    for (name, zones) in instruments {
        // inst: name(20), wInstBagNdx(u16)
        inst.extend(name20(name));
        write_u16(&mut inst, zone_index);

        for zone in zones {
            write_u16(&mut ibag, gen_index);
            write_u16(&mut ibag, 0);
            for (t, v) in zone {
                write_u16(&mut igen, *t);
                write_u16(&mut igen, *v);
                gen_index += 1;
            }
            zone_index += 1;
        }
    }

    // 終端 inst（EOI）。
    inst.extend(name20("EOI"));
    write_u16(&mut inst, zone_index);
    // 終端 ibag / igen。
    write_u16(&mut ibag, gen_index);
    write_u16(&mut ibag, 0);
    write_u16(&mut igen, 0);
    write_u16(&mut igen, 0);

    (inst, ibag, igen)
}

/// shdr を組み立てる（各 46 バイト + 終端 EOS）。
fn build_shdr(specs: &[SampleSpec]) -> Vec<u8> {
    let mut d = Vec::new();
    for s in specs {
        d.extend(name20(s.name));
        write_u32(&mut d, s.start);
        write_u32(&mut d, s.end);
        write_u32(&mut d, s.start_loop);
        write_u32(&mut d, s.end_loop);
        write_u32(&mut d, SAMPLE_RATE);
        d.push(s.original_pitch); // original_pitch (u8)
        d.push(0); // pitch_correction (i8)
        write_u16(&mut d, 0); // sample link
        write_u16(&mut d, 1); // sample_type = monoSample
    }
    // 終端 EOS レコード。
    d.extend(name20("EOS"));
    for _ in 0..5 {
        write_u32(&mut d, 0);
    }
    d.push(0);
    d.push(0);
    write_u16(&mut d, 0);
    write_u16(&mut d, 0);
    d
}

// ------- バイナリ書き込みヘルパ（すべてリトルエンディアン）-------

fn write_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

/// 20 バイト固定長の名前（ゼロ埋め、必ずヌル終端が入るよう 19 文字まで）。
fn name20(name: &str) -> [u8; 20] {
    let mut out = [0u8; 20];
    let bytes = name.as_bytes();
    let n = bytes.len().min(19);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

/// ヌル終端 + 偶数長になるように詰めた文字列。
fn even_cstr(s: &str) -> Vec<u8> {
    let mut v = s.as_bytes().to_vec();
    v.push(0);
    if !v.len().is_multiple_of(2) {
        v.push(0);
    }
    v
}

/// `id` + サイズ(u32 LE) + データ の RIFF サブチャンク。
fn chunk(id: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(id);
    write_u32(&mut out, data.len() as u32);
    out.extend_from_slice(data);
    out
}

/// LIST チャンク（`list_type` + サブチャンク群）。
fn list_chunk(list_type: &[u8; 4], subs: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(4 + subs.len());
    data.extend_from_slice(list_type);
    data.extend_from_slice(subs);
    chunk(b"LIST", &data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};
    use std::io::Cursor;
    use std::sync::Arc;

    #[test]
    fn loads_with_rustysynth() {
        let sf2 = build_dev_sf2();
        let font = SoundFont::new(&mut Cursor::new(&sf2)).expect("SoundFont のロードに失敗");
        assert_eq!(font.get_presets().len(), 4, "プリセット数が 4 でない");
        assert_eq!(
            font.get_instruments().len(),
            4,
            "インストゥルメント数が 4 でない"
        );
        assert_eq!(
            font.get_sample_headers().len(),
            10,
            "サンプル数が 10 でない"
        );
    }

    #[test]
    fn under_size_budget() {
        let sf2 = build_dev_sf2();
        assert!(
            sf2.len() < 160 * 1024,
            "SF2 が 160KB を超過: {} bytes",
            sf2.len()
        );
    }

    #[test]
    fn percussion_keys_are_non_silent() {
        let sf2 = build_dev_sf2();
        for key in [35_i32, 36, 37, 38, 39, 42, 46] {
            let p = render_peak(&sf2, key);
            assert!(p > 0.05, "パーカッション key {key} が無音: peak={p}");
        }
    }

    #[test]
    fn lead_preset_is_non_silent() {
        // bank0 preset0（矩形波 Lead）を ch0 でならす。
        let sf2 = build_dev_sf2();
        let font = Arc::new(SoundFont::new(&mut Cursor::new(&sf2)).unwrap());
        let settings = SynthesizerSettings::new(SAMPLE_RATE as i32);
        let mut synth = Synthesizer::new(&font, &settings).unwrap();
        synth.process_midi_message(0, 0xC0, 0, 0); // program change → preset 0
        synth.note_on(0, 60, 120);
        let mut left = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
        let mut right = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
        synth.render(&mut left, &mut right);
        let p = peak(&left).max(peak(&right));
        assert!(p > 0.05, "Lead が無音: peak={p}");
    }

    #[test]
    fn bass_and_chime_presets_are_non_silent() {
        // bank0 preset1（三角波 Bass）/ preset2（正弦波 Chime）を ch0 でならす。
        let sf2 = build_dev_sf2();
        for program in [1_i32, 2] {
            let font = Arc::new(SoundFont::new(&mut Cursor::new(&sf2)).unwrap());
            let settings = SynthesizerSettings::new(SAMPLE_RATE as i32);
            let mut synth = Synthesizer::new(&font, &settings).unwrap();
            synth.process_midi_message(0, 0xC0, program, 0); // program change → preset 1 / 2
            synth.note_on(0, 60, 120);
            let mut left = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
            let mut right = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
            synth.render(&mut left, &mut right);
            let p = peak(&left).max(peak(&right));
            assert!(p > 0.05, "program {program} が無音: peak={p}");
        }
    }

    /// パーカッションチャンネル（ch9）で `key` をならしたピーク。
    fn render_peak(sf2: &[u8], key: i32) -> f32 {
        let font = Arc::new(SoundFont::new(&mut Cursor::new(sf2)).unwrap());
        let settings = SynthesizerSettings::new(SAMPLE_RATE as i32);
        let mut synth = Synthesizer::new(&font, &settings).unwrap();
        synth.note_on(9, key, 120);
        let mut left = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
        let mut right = vec![0.0_f32; (SAMPLE_RATE / 2) as usize];
        synth.render(&mut left, &mut right);
        peak(&left).max(peak(&right))
    }

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0_f32, |m, &x| m.max(x.abs()))
    }
}
