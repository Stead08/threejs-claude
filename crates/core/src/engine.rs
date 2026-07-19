//! 判定エンジン: キュー接近・入力マッチング・オートミス・統計を
//! 決定論的に処理する。フレームループ相当の [`Engine::tick`] は
//! ヒープ割り当てをしない（内部状態と出力バッファを再利用する）。

use crate::chart::Chart;

/// 判定ウィンドウ設定（ミリ秒）。
#[derive(Debug, Clone, Copy)]
pub struct JudgeConfig {
    /// |error| がこの値以下なら Just（境界含む）。
    pub just_ms: f64,
    /// |error| がこの値以下なら Safe（境界含む）。範囲外の入力は無視。
    pub safe_ms: f64,
}

impl Default for JudgeConfig {
    fn default() -> Self {
        Self {
            just_ms: 45.0,
            safe_ms: 100.0,
        }
    }
}

/// 判定結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Judgment {
    Just = 0,
    Safe = 1,
    Miss = 2,
}

/// プレイヤ入力（時刻と動詞 ID）。M0 は verb=0（タップ）のみ。
#[derive(Debug, Clone, Copy)]
pub struct Input {
    pub time_sec: f64,
    pub verb: u16,
}

/// tick で発生したイベント。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event {
    /// キューが接近ウィンドウに入った（時刻順に一度だけ発火）。
    CueApproach {
        cue_index: u32,
        kind: u16,
        target_sec: f64,
    },
    /// 入力がキューに割り当てられ判定された。error = input - target（正=遅い）。
    Judged {
        cue_index: u32,
        judgment: Judgment,
        error_ms: f64,
    },
    /// 未判定のままウィンドウを過ぎた（自動ミス）。
    AutoMiss { cue_index: u32 },
}

/// 集計統計。mean/std は Just+Safe の誤差のみを Welford で逐次計算する。
#[derive(Debug, Clone)]
pub struct Stats {
    /// 譜面のキュー総数。
    pub total_cues: u32,
    /// 判定済み（just + safe + miss）。
    pub judged: u32,
    pub just: u32,
    pub safe: u32,
    pub miss: u32,
    /// Just+Safe 誤差の平均（ms）。
    pub mean_ms: f64,
    /// Just+Safe 誤差の母標準偏差（ms、n で割る）。
    pub std_ms: f64,
    /// 誤差ヒストグラム。bin = clamp(floor((error_ms + 100) / 10), 0, 19)。
    /// -100..100ms を 10ms 刻みで 20 bin。
    pub histogram: [u32; 20],
}

impl Stats {
    fn new(total_cues: u32) -> Self {
        Self {
            total_cues,
            judged: 0,
            just: 0,
            safe: 0,
            miss: 0,
            mean_ms: 0.0,
            std_ms: 0.0,
            histogram: [0; 20],
        }
    }
}

/// Welford のオンライン分散アルゴリズム状態。
#[derive(Debug, Clone, Default)]
struct Welford {
    n: u64,
    mean: f64,
    m2: f64,
}

impl Welford {
    fn update(&mut self, x: f64) {
        self.n += 1;
        let delta = x - self.mean;
        self.mean += delta / self.n as f64;
        let delta2 = x - self.mean;
        self.m2 += delta * delta2;
    }

    /// 母標準偏差（n で割る）。
    fn std(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            (self.m2 / self.n as f64).sqrt()
        }
    }
}

/// ヒストグラムの bin を計算する。
fn hist_bin(error_ms: f64) -> usize {
    let raw = ((error_ms + 100.0) / 10.0).floor();
    raw.clamp(0.0, 19.0) as usize
}

/// 判定エンジン。
pub struct Engine {
    chart: Chart,
    config: JudgeConfig,
    approach_sec: f64,
    /// キューごとの解決済みフラグ（Just/Safe/Miss いずれか）。
    resolved: Vec<bool>,
    /// 次に接近発火すべきキュー index（時刻昇順に前進）。
    approach_cursor: usize,
    welford: Welford,
    stats: Stats,
}

impl Engine {
    /// 譜面・判定設定・接近秒数からエンジンを生成する。
    pub fn new(chart: Chart, config: JudgeConfig, approach_sec: f64) -> Self {
        let total = chart.cues.len();
        Self {
            resolved: vec![false; total],
            approach_cursor: 0,
            welford: Welford::default(),
            stats: Stats::new(total as u32),
            chart,
            config,
            approach_sec,
        }
    }

    /// 毎フレーム 1 回呼ぶ。`inputs` は時刻昇順。`events` はクリアして再利用する
    /// （割り当てゼロ運用）。
    ///
    /// 処理順（決定論）:
    /// 1. CueApproach を時刻順に一度だけ発火。
    /// 2. 各入力を、未判定かつ |error| <= safe_ms のキューのうち |error| 最小へ割り当て。
    ///    範囲外なら無視。タイは早いキュー優先。
    /// 3. now > target + safe_ms の未判定キューを AutoMiss。
    pub fn tick(&mut self, now_sec: f64, inputs: &[Input], events: &mut Vec<Event>) {
        events.clear();

        let cues = &self.chart.cues;
        let n = cues.len();
        let just_ms = self.config.just_ms;
        let safe_ms = self.config.safe_ms;
        let safe_sec = safe_ms / 1000.0;

        // 1) 接近発火。キューは時刻昇順なので、接近閾値 (target - approach) も昇順。
        //    カーソルを前進させ、各キューを一度だけ発火する。
        while self.approach_cursor < n {
            let cue = &cues[self.approach_cursor];
            if now_sec >= cue.time_sec - self.approach_sec {
                events.push(Event::CueApproach {
                    cue_index: self.approach_cursor as u32,
                    kind: cue.kind,
                    target_sec: cue.time_sec,
                });
                self.approach_cursor += 1;
            } else {
                break;
            }
        }

        // 2) 入力マッチング（入力順）。
        for input in inputs {
            let mut best: Option<usize> = None;
            let mut best_abs = f64::INFINITY;
            let mut best_err = 0.0_f64;
            for (i, cue) in cues.iter().enumerate() {
                if self.resolved[i] {
                    continue;
                }
                let err_ms = (input.time_sec - cue.time_sec) * 1000.0;
                let a = err_ms.abs();
                // <= safe_ms は境界含む。同値タイは早いキュー優先なので厳密比較 `<`。
                if a <= safe_ms && a < best_abs {
                    best_abs = a;
                    best_err = err_ms;
                    best = Some(i);
                }
            }
            if let Some(i) = best {
                self.resolved[i] = true;
                let judgment = if best_abs <= just_ms {
                    Judgment::Just
                } else {
                    Judgment::Safe
                };
                match judgment {
                    Judgment::Just => self.stats.just += 1,
                    Judgment::Safe => self.stats.safe += 1,
                    Judgment::Miss => unreachable!(),
                }
                self.stats.judged += 1;
                self.welford.update(best_err);
                self.stats.mean_ms = self.welford.mean;
                self.stats.std_ms = self.welford.std();
                self.stats.histogram[hist_bin(best_err)] += 1;
                events.push(Event::Judged {
                    cue_index: i as u32,
                    judgment,
                    error_ms: best_err,
                });
            }
            // 範囲内キューが無ければ空振り（イベントなし）。
        }

        // 3) オートミス（キュー順）。
        for (i, cue) in cues.iter().enumerate() {
            if self.resolved[i] {
                continue;
            }
            if now_sec > cue.time_sec + safe_sec {
                self.resolved[i] = true;
                self.stats.miss += 1;
                self.stats.judged += 1;
                events.push(Event::AutoMiss { cue_index: i as u32 });
            }
        }
    }

    /// 現在の統計。
    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    /// 全キュー判定済み、または曲終了（now >= duration_sec）なら true。
    pub fn finished(&self, now_sec: f64) -> bool {
        self.stats.judged >= self.stats.total_cues || now_sec >= self.chart.duration_sec
    }
}
