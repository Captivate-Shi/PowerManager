use std::time::{Duration, Instant};

pub(crate) const SINGLE_DELAY: Duration = Duration::from_millis(300);
const DOUBLE_RELEASE_GRACE: Duration = Duration::from_millis(180);

pub(crate) struct TrayClicks {
    pending_up: Option<Instant>,
    double_at: Option<Instant>,
}

impl TrayClicks {
    pub(crate) const fn new() -> Self { Self { pending_up: None, double_at: None } }

    pub(crate) fn left_up(&mut self, now: Instant) -> bool {
        if self.double_at.take().is_some_and(|at| now.duration_since(at) < DOUBLE_RELEASE_GRACE) {
            return false;
        }
        self.pending_up = Some(now);
        true
    }

    pub(crate) fn double_click(&mut self, now: Instant) -> Option<Duration> {
        self.double_at = Some(now);
        self.pending_up.take().map(|at| now.duration_since(at))
    }

    pub(crate) fn finish_pending(&mut self) { self.pending_up = None; }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_double_remains_eligible_after_delay_if_panel_is_still_hidden() {
        for ms in [110, 300, 385, 490] {
            let t = Instant::now();
            let mut clicks = TrayClicks::new();
            assert!(clicks.left_up(t));
            let second = t + Duration::from_millis(ms);
            assert_eq!(clicks.double_click(second), Some(Duration::from_millis(ms)));
            assert!(!clicks.left_up(second + Duration::from_millis(25)));
        }
    }

    #[test]
    fn visible_panel_commits_the_single_but_a_new_gesture_can_open_main() {
        let t = Instant::now();
        let mut clicks = TrayClicks::new();
        assert!(clicks.left_up(t));
        clicks.finish_pending();
        assert_eq!(clicks.double_click(t + Duration::from_millis(385)), None);
        assert!(!clicks.left_up(t + Duration::from_millis(395)));
        assert!(clicks.left_up(t + Duration::from_millis(600)));
        assert_eq!(clicks.double_click(t + Duration::from_millis(700)), Some(Duration::from_millis(100)));
    }
}
