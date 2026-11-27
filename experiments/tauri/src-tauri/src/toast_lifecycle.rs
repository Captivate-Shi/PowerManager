use std::time::Duration;

pub const DEFAULT_SECONDS: u64 = 12;
pub fn valid_seconds(value: u64) -> bool { matches!(value, 0 | 5 | 10 | 12 | 15) }

#[derive(Clone, Copy)]
pub struct ToastSlot {
    pub ticket: u64,
    seconds: u64,
    pub presented: bool,
    pub closing: bool,
    pub epoch: u64,
}
impl ToastSlot {
    pub fn new(ticket: u64, seconds: u64) -> Self {
        Self { ticket, seconds: if valid_seconds(seconds) { seconds } else { DEFAULT_SECONDS }, presented: false, closing: false, epoch: 0 }
    }
    pub fn present(&mut self) -> Option<Duration> {
        if self.presented || self.closing { return None; }
        self.presented = true;
        (self.seconds != 0).then(|| Duration::from_secs(self.seconds))
    }
    pub fn restart(&mut self, seconds: u64) -> Option<Duration> {
        self.seconds = if valid_seconds(seconds) { seconds } else { DEFAULT_SECONDS };
        self.epoch += 1;
        (self.presented && !self.closing && self.seconds != 0).then(|| Duration::from_secs(self.seconds))
    }
    pub fn timeout_matches(&self, ticket: u64, epoch: u64) -> bool {
        self.ticket == ticket && self.epoch == epoch && self.presented && !self.closing
    }
    pub fn matches(&self, ticket: u64, only_if_hidden: bool) -> bool {
        self.ticket == ticket && (!only_if_hidden || (!self.presented && !self.closing))
    }
}

/// Keep the original visual order while admitting each new incident once.
pub fn join_member(members: &mut Vec<String>, id: &str) -> bool {
    if members.iter().any(|member| member == id) { return false; }
    members.push(id.to_owned());
    true
}

pub fn admits_popup(severity: &str, active_members: usize, preview: bool) -> bool {
    severity == "critical" || (active_members == 0 && !preview)
}

pub fn keep_member(status: &str, confirmed_level: Option<&str>, active_level: &str) -> bool {
    status != "offline" && (status != "current" || confirmed_level == Some(active_level))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critical_preempts_low_and_preview_but_not_the_other_way_around() {
        assert!(admits_popup("critical", 1, false));
        assert!(admits_popup("critical", 0, true));
        assert!(!admits_popup("low", 1, false));
        assert!(!admits_popup("low", 0, true));
        assert!(admits_popup("low", 0, false));
    }
    #[test]
    fn charging_retracts_only_that_device_and_later_incidents_keep_join_order() {
        let mut members = vec!["a".into(), "b".into(), "c".into()];
        assert!(!join_member(&mut members, "a"));
        members.retain(|id| keep_member(if id == "c" { "no_radio_reply" } else { "current" },
            if id == "a" { None } else { Some("critical") }, "critical"));
        assert_eq!(members, ["b", "c"]);
        assert!(join_member(&mut members, "a")); // fresh low reading after disconnecting charge
        assert!(join_member(&mut members, "d"));
        assert_eq!(&members[..3], &["b", "c", "a"]); // additional device remains counted, not pictured
        assert!(!keep_member("offline", Some("critical"), "critical"));
        assert!(!keep_member("current", Some("critical"), "low"));
    }
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
    fn superseding_low_and_adding_critical_invalidates_older_timeout() {
        let mut slot = ToastSlot::new(13, 12);
        assert_eq!(slot.present(), Some(Duration::from_secs(12)));
        assert!(slot.timeout_matches(13, 0));
        assert_eq!(slot.restart(0), None);
        assert!(!slot.timeout_matches(13, 0));
        assert_eq!(slot.restart(5), Some(Duration::from_secs(5)));
        assert!(!slot.timeout_matches(12, 2));
        assert!(slot.timeout_matches(13, 2));
        slot.closing = true;
        assert!(!slot.timeout_matches(13, 2));
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
