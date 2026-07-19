//! テンポマップ: PPQ とテンポ変更点列を保持し、区間積分で時刻変換する。
//!
//! beat は `tick / ppq` の連続量として定義する。各テンポ区間は
//! `sec_per_tick = us_per_quarter / 1_000_000 / ppq` の一定勾配なので、
//! 変更点ごとの累積秒 `cum_sec` を前計算しておけば O(区間数) で相互変換できる。

/// テンポ変更点（絶対 tick と 4 分音符あたりのマイクロ秒）。
#[derive(Debug, Clone, Copy)]
struct TempoChange {
    tick: u64,
    us_per_quarter: u32,
}

/// PPQ とテンポ変更点列に基づく tick/beat ⇄ 秒 変換器。
#[derive(Debug, Clone)]
pub struct TempoMap {
    ppq: u32,
    /// tick 昇順・先頭は必ず tick 0。
    changes: Vec<TempoChange>,
    /// `cum_sec[i]` = tick 0 から `changes[i].tick` までの経過秒。
    cum_sec: Vec<f64>,
}

impl TempoMap {
    /// `points`（tick, us_per_quarter）からテンポマップを構築する。
    ///
    /// - `points` は昇順でなくてよい（内部で安定ソートする）。
    /// - 同一 tick に複数のテンポがある場合は後勝ち（MIDI と同じ挙動）。
    /// - 先頭が tick 0 でない場合は既定 120BPM（500000us）を tick 0 に補う
    ///   （SMF は最初の set_tempo までを 120BPM とみなす規約）。
    /// - `points` が空なら 120BPM 単一区間になる。
    pub fn from_points(ppq: u32, points: &[(u64, u32)]) -> Self {
        let mut sorted: Vec<(u64, u32)> = points.to_vec();
        sorted.sort_by_key(|&(tick, _)| tick);

        let mut changes: Vec<TempoChange> = Vec::with_capacity(sorted.len() + 1);
        for (tick, us) in sorted {
            if let Some(last) = changes.last_mut() {
                if last.tick == tick {
                    // 同一 tick は後勝ち
                    last.us_per_quarter = us;
                    continue;
                }
            }
            changes.push(TempoChange {
                tick,
                us_per_quarter: us,
            });
        }
        if changes.first().is_none_or(|c| c.tick != 0) {
            changes.insert(
                0,
                TempoChange {
                    tick: 0,
                    us_per_quarter: 500_000,
                },
            );
        }

        let ppq_f = ppq as f64;
        let mut cum_sec = vec![0.0_f64; changes.len()];
        for i in 1..changes.len() {
            let dt_ticks = (changes[i].tick - changes[i - 1].tick) as f64;
            let sec_per_tick = changes[i - 1].us_per_quarter as f64 / 1_000_000.0 / ppq_f;
            cum_sec[i] = cum_sec[i - 1] + dt_ticks * sec_per_tick;
        }

        TempoMap {
            ppq,
            changes,
            cum_sec,
        }
    }

    /// PPQ（1 拍あたりの tick 数）。
    pub fn ppq(&self) -> u32 {
        self.ppq
    }

    /// 指定区間の 1 tick あたりの秒。
    fn sec_per_tick(&self, seg: usize) -> f64 {
        self.changes[seg].us_per_quarter as f64 / 1_000_000.0 / self.ppq as f64
    }

    /// `tick`（分数可）を秒へ。負 tick は先頭区間の勾配で外挿する。
    fn tick_f_to_sec(&self, tick: f64) -> f64 {
        // tick <= changes[seg].tick を満たす最後の区間を探す。
        let mut seg = 0usize;
        for i in 0..self.changes.len() {
            if self.changes[i].tick as f64 <= tick {
                seg = i;
            } else {
                break;
            }
        }
        self.cum_sec[seg] + (tick - self.changes[seg].tick as f64) * self.sec_per_tick(seg)
    }

    /// tick → 秒。
    pub fn tick_to_sec(&self, tick: u64) -> f64 {
        self.tick_f_to_sec(tick as f64)
    }

    /// beat（= tick/ppq の連続量）→ 秒。
    pub fn beat_to_sec(&self, beat: f64) -> f64 {
        self.tick_f_to_sec(beat * self.ppq as f64)
    }

    /// 秒 → beat（tick_to_sec の逆変換）。
    pub fn sec_to_beat(&self, sec: f64) -> f64 {
        // cum_sec[seg] <= sec を満たす最後の区間を探す。
        let mut seg = 0usize;
        for i in 0..self.cum_sec.len() {
            if self.cum_sec[i] <= sec {
                seg = i;
            } else {
                break;
            }
        }
        let tick =
            self.changes[seg].tick as f64 + (sec - self.cum_sec[seg]) / self.sec_per_tick(seg);
        tick / self.ppq as f64
    }
}
