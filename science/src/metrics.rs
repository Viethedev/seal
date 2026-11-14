//! Step 4: mission metrics over an evenly spaced time series.

/// One time step for one site.
#[derive(Debug, Clone, Copy)]
pub struct Sample {
    /// UNIX time (s, UTC).
    pub t: f64,
    /// Visible fraction of the solar disk (0..1).
    pub sun_frac: f64,
    /// Visible fraction of the Earth disk (0..1).
    pub earth_frac: f64,
}

impl Sample {
    pub fn lit(&self) -> bool {
        self.sun_frac > 0.0
    }
    /// Direct-to-Earth contact: Earth's centre above the terrain.
    pub fn earth_contact(&self) -> bool {
        self.earth_frac >= 0.5
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Metrics {
    pub sunlit_pct: f64,
    pub sunlit_hours: f64,
    pub longest_dark_hours: f64,
    pub earth_visible_pct: f64,
    pub earth_visible_hours: f64,
    pub longest_blackout_hours: f64,
    /// First lit → dark transition after the start (UNIX s), if any.
    pub next_sunset: Option<f64>,
    /// First contact → no-contact transition after the start (UNIX s), if any.
    pub next_earthset: Option<f64>,
    /// Days from the start until sunset or Earthset, whichever comes first.
    /// 0 if the site has no Sun or no Earth at the start.
    pub usable_mission_days: f64,
    /// True when neither sunset nor Earthset happened inside the range, so
    /// `usable_mission_days` is only a lower bound.
    pub mission_runs_past_range: bool,
}

fn longest_run(flags: impl Iterator<Item = bool>) -> usize {
    let (mut best, mut cur) = (0, 0);
    for f in flags {
        if f {
            cur += 1;
            best = best.max(cur);
        } else {
            cur = 0;
        }
    }
    best
}

fn first_fall(samples: &[Sample], on: impl Fn(&Sample) -> bool) -> Option<f64> {
    samples.windows(2).find(|w| on(&w[0]) && !on(&w[1])).map(|w| w[1].t)
}

/// Metrics for samples spaced evenly in time (at least two samples).
pub fn metrics(samples: &[Sample]) -> Metrics {
    assert!(samples.len() >= 2, "need at least two samples");
    let n = samples.len() as f64;
    let dt_h = (samples[1].t - samples[0].t) / 3600.0;

    let lit = samples.iter().filter(|s| s.lit()).count() as f64;
    let earth = samples.iter().filter(|s| s.earth_contact()).count() as f64;

    let next_sunset = first_fall(samples, Sample::lit);
    let next_earthset = first_fall(samples, Sample::earth_contact);

    let t0 = samples[0].t;
    let t_end = samples[samples.len() - 1].t;
    let (usable_mission_days, mission_runs_past_range) =
        if samples[0].lit() && samples[0].earth_contact() {
            let end = [next_sunset, next_earthset].into_iter().flatten().fold(f64::INFINITY, f64::min);
            if end.is_finite() {
                ((end - t0) / 86_400.0, false)
            } else {
                ((t_end - t0) / 86_400.0, true)
            }
        } else {
            (0.0, false)
        };

    Metrics {
        sunlit_pct: 100.0 * lit / n,
        sunlit_hours: lit * dt_h,
        longest_dark_hours: longest_run(samples.iter().map(|s| !s.lit())) as f64 * dt_h,
        earth_visible_pct: 100.0 * earth / n,
        earth_visible_hours: earth * dt_h,
        longest_blackout_hours: longest_run(samples.iter().map(|s| !s.earth_contact())) as f64
            * dt_h,
        next_sunset,
        next_earthset,
        usable_mission_days,
        mission_runs_past_range,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(sun: &[f64], earth: &[f64]) -> Vec<Sample> {
        sun.iter()
            .zip(earth)
            .enumerate()
            .map(|(i, (&s, &e))| Sample { t: i as f64 * 3600.0, sun_frac: s, earth_frac: e })
            .collect()
    }

    #[test]
    fn hourly_series_metrics() {
        // 6 hours: lit for 3 h, then dark 3 h; Earth in contact for first 5 h.
        let s = series(&[1.0, 1.0, 0.4, 0.0, 0.0, 0.0], &[1.0, 1.0, 1.0, 1.0, 1.0, 0.2]);
        let m = metrics(&s);
        assert!((m.sunlit_hours - 3.0).abs() < 1e-12);
        assert!((m.longest_dark_hours - 3.0).abs() < 1e-12);
        assert_eq!(m.next_sunset, Some(3.0 * 3600.0));
        assert_eq!(m.next_earthset, Some(5.0 * 3600.0));
        assert!((m.usable_mission_days - 3.0 / 24.0).abs() < 1e-12);
        assert!(!m.mission_runs_past_range);
    }

    #[test]
    fn no_power_at_start_means_zero_mission() {
        let s = series(&[0.0, 1.0, 1.0], &[1.0, 1.0, 1.0]);
        assert_eq!(metrics(&s).usable_mission_days, 0.0);
    }

    #[test]
    fn mission_lasting_past_range_is_flagged() {
        let s = series(&[1.0; 4], &[1.0; 4]);
        let m = metrics(&s);
        assert!(m.mission_runs_past_range);
        assert!((m.usable_mission_days - 3.0 / 24.0).abs() < 1e-12);
    }
}
