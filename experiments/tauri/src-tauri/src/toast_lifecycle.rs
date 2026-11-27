use std::time::Duration;

pub const DEFAULT_SECONDS: u64 = 12;
pub fn valid_seconds(value: u64) -> bool { matches!(value, 0 | 5 | 10 | 12 | 15) }

#[derive(Clone, Copy)]
pub struct ToastSlot {
    pub ticket: u64,
    seconds: u64,
    pub presented: bool,
}
impl ToastSlot {
    pub fn new(ticket: u64, seconds: u64) -> Self {
        Self { ticket, seconds: if valid_seconds(seconds) { seconds } else { DEFAULT_SECONDS }, presented: false }
    }
    pub fn present(&mut self) -> Option<Duration> {
        if self.presented { return None; }
        self.presented = true;
        (self.seconds != 0).then(|| Duration::from_secs(self.seconds))
    }
    pub fn matches(&self, ticket: u64, only_if_hidden: bool) -> bool {
        self.ticket == ticket && (!only_if_hidden || !self.presented)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_starts_once_at_presentation_and_respects_duration() {
        for seconds in [5, 10, 12, 15, 20] {
            let mut slot = ToastSlot::new(8, seconds);
            assert!(slot.matches(8, true));
            let expected = if seconds == 20 { DEFAULT_SECONDS } else { seconds };
            assert_eq!(slot.present(), Some(Duration::from_secs(expected)));
            assert_eq!(slot.present(), None);
            assert!(!slot.matches(8, true));
            assert!(slot.matches(8, false));
            assert!(!slot.matches(7, false));
        }
    }
    #[test]
    fn persistent_alert_survives_hidden_watchdog_after_presentation() {
        let mut slot = ToastSlot::new(5, 0);
        assert!(slot.matches(5, true));
        assert_eq!(slot.present(), None);
        assert!(!slot.matches(5, true));
        assert!(slot.matches(5, false));
        assert!(!slot.matches(4, false));
    }
}
