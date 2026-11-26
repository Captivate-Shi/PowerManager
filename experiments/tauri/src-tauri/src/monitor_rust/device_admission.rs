// A discovered endpoint is not necessarily a device that has connected.
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && !s.chars().any(char::is_control)
}
pub(super) fn measured(sample: &Value) -> bool {
    sample["status"] == "current" && good_reading(&sample["reading"])
}
pub(super) fn good_reading(reading: &Value) -> bool {
    let (Some(lo), Some(hi)) = (reading["low"].as_u64(), reading["high"].as_u64()) else { return false };
    lo <= hi && hi <= 100 && matches!(reading["power"].as_str(), Some("full" | "charging" | "discharging" | "unknown"))
}
pub(super) fn may_enroll(row: &Value, known: bool, watched: bool) -> bool {
    // A native basic Bluetooth input packet proves a live link even when
    // that packet does not carry battery data. A Windows inventory row does not.
    let live_input = row["art"].as_str().is_some_and(|art| art != "unknown")
        && row["sample"]["status"] == "basic_bluetooth";
    known || watched || live_input || measured(&row["sample"])
}
pub(super) fn phantom(device: &Value, storage: &Value) -> bool {
    let Some(id) = device["id"].as_str() else { return false };
    device["art"] == "unknown"
        && !device["watched"].as_bool().unwrap_or_default()
        && device["lastRead"].is_null()
        && !good_reading(&device["reading"])
        && storage["deviceSettings"][id].as_object().is_none_or(|s| s.is_empty())
        && storage["watched"].as_array().is_none_or(|w| !w.iter().any(|d| d["id"] == id))
        && storage["history"][id].as_array().is_none_or(|h| !h.iter().any(|pt| good_reading(&pt["reading"])))
        && storage["historyDays"][id].as_array().is_none_or(|h| h.is_empty())
}

pub(super) fn aliases(rows: &[Value]) -> BTreeMap<&str, &str> {
    let primary: BTreeSet<_> = rows.iter().filter(|r| r["art"] != "unknown")
        .filter_map(|r| r["id"].as_str()).collect();
    let mut owner = BTreeMap::<&str, Option<&str>>::new();
    for row in rows {
        let Some(id) = row["id"].as_str().filter(|s| valid_id(s)) else { continue };
        if !primary.contains(id) { continue }
        for name in row["aliases"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if name == id || !valid_id(name) || primary.contains(name) { continue }
            owner.entry(name).and_modify(|old| { if *old != Some(id) { *old = None; } }).or_insert(Some(id));
        }
    }
    owner.into_iter().filter_map(|(name, id)| id.map(|id| (name, id))).collect()
}

pub(super) fn take_previous(old: &mut Vec<Value>, id: &str, owners: &BTreeMap<&str, &str>) -> (Option<Value>, Vec<String>) {
    let mut canonical: Option<Value> = None;
    let mut previous: Option<Value> = None;
    let mut retired = Vec::new();
    old.retain(|device| {
        let Some(old_id) = device["id"].as_str() else { return true };
        if old_id == id { canonical = Some(device.clone()); return false }
        if owners.get(old_id) != Some(&id) { return true }
        retired.push(old_id.to_owned());
        // Keep a previously measured value when only a generic row existed, or
        // when the canonical row is older; an incoming live sample wins later.
        if previous.as_ref().is_none_or(|d| d["lastRead"].as_u64() < device["lastRead"].as_u64()) {
            previous = Some(device.clone());
        }
        false
    });
    let previous = match (canonical, previous) {
        (Some(a), Some(b)) if b["lastRead"].as_u64() > a["lastRead"].as_u64() => Some(b),
        (a,b) => a.or(b),
    };
    (previous, retired)
}

pub(super) fn combine_history(map: &mut Value, alias: &str, id: &str, key: &str) {
    let Some(object) = map.as_object_mut() else { return };
    let Some(Value::Array(source)) = object.remove(alias) else { return };
    if source.is_empty() { return }
    let target = object.entry(id).or_insert_with(|| Value::Array(Vec::new()));
    if !target.is_array() { *target = Value::Array(Vec::new()); }
    let target = target.as_array_mut().unwrap();
    if target.is_empty() { *target = source; return }
    let mut by_time = BTreeMap::new();
    for value in target.drain(..) {
        if let Some(at) = value[key].as_u64() { by_time.insert(at, value); }
    }
    for value in source {
        let Some(at) = value[key].as_u64() else { continue };
        by_time.entry(at).and_modify(|current| {
            if key == "time" {
                if !good_reading(&current["reading"]) && good_reading(&value["reading"]) { *current = value.clone(); }
            } else {
                let low = |d: &Value| d["lowest"]["reading"]["low"].as_u64().unwrap_or(101);
                if low(&value) < low(current) { current["lowest"] = value["lowest"].clone(); }
                if value["lastCharge"].as_u64() > current["lastCharge"].as_u64() { current["lastCharge"] = value["lastCharge"].clone(); }
                // Both providers may have sampled the same interval. Don't double count shared days.
                if value["count"].as_u64() > current["count"].as_u64() { current["count"] = value["count"].clone(); }
            }
        }).or_insert(value);
    }
    let limit = if key == "time" { 10000 } else { 365 };
    let skip = by_time.len().saturating_sub(limit);
    target.extend(by_time.into_values().skip(skip));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairing_probe_or_offline_does_not_create_a_row() {
        for sample in [Value::Null,json!({"status":"offline"}),json!({"status":"unavailable"}),json!({"status":"current","reading":null})] {
            let row = json!({"name":"DualSense", "automatic":true,"sample":sample});
            assert!(!may_enroll(&row,false,false));
            assert!(may_enroll(&row,true,false));
            assert!(may_enroll(&row,false,true));
        }
        assert!(may_enroll(&json!({"sample":{"status":"current","reading":{"low":0,"high":9,"power":"discharging"}}}),false,false));
        assert!(may_enroll(&json!({"art":"dualsense","sample":{"status":"basic_bluetooth"}}),false,false));
        assert!(!may_enroll(&json!({"art":"unknown","sample":{"status":"basic_bluetooth"}}),false,false));
    }
    #[test]
    fn same_model_with_other_identity_remains_separate() {
        let rows = [
            json!({"id":"dualsense:a","name":"DualSense","art":"dualsense","aliases":["win:a"]}),
            json!({"id":"dualsense:b","name":"DualSense","art":"dualsense","aliases":["win:b"]}),
            json!({"id":"win:a","name":"DualSense Wireless Controller","art":"unknown"}),
        ];
        let mut previous = vec![
            json!({"id":"win:a","lastRead":null}),
            json!({"id":"dualsense:a","lastRead":1}),
            json!({"id":"win:b","lastRead":2}),
        ];
        let (current, retired) = take_previous(&mut previous,"dualsense:a",&aliases(&rows));
        assert_eq!(current.unwrap()["lastRead"],1);
        assert_eq!(retired,vec!["win:a"]);
        assert_eq!(previous[0]["id"],"win:b");
        let mut conflicting = rows.clone();
        conflicting[1]["aliases"] = json!(["win:a"]);
        assert!(!aliases(&conflicting).contains_key("win:a"));
    }
    #[test]
    fn old_ghost_can_be_hidden_without_touching_real_history_or_manual_devices() {
        let ghost=json!({"id":"win:a","art":"unknown","lastRead":null,"watched":false});
        assert!(phantom(&ghost,&json!({})));
        assert!(!phantom(&ghost,&json!({"watched":[{"id":"win:a"}]})));
        assert!(!phantom(&ghost,&json!({"deviceSettings":{"win:a":{"alias":"My pad"}}})));
        assert!(!phantom(&ghost,&json!({"history":{"win:a":[{"time":1,"reading":{"low":70,"high":79,"power":"discharging"}}]}})));
    }

    #[test]
    fn exact_alias_keeps_real_readings_and_daily_extrema() {
        let mut data=json!({"native":[{"time":2,"reading":null}],"generic":[{"time":1,"reading":null},{"time":2,"reading":{"low":70,"high":79,"power":"discharging"}}]});
        combine_history(&mut data,"generic","native","time");
        assert!(data["generic"].is_null());
        assert_eq!(data["native"].as_array().unwrap().len(),2);
        assert_eq!(data["native"][1]["reading"]["low"],70);
        let mut days=json!({"native":[{"day":1,"count":5,"lowest":{"reading":{"low":81}}}],"generic":[{"day":1,"count":5,"lowest":{"reading":{"low":70}},"lastCharge":2}]});
        combine_history(&mut days,"generic","native","day");
        assert_eq!(days["native"][0]["lowest"]["reading"]["low"],70);
        assert_eq!(days["native"][0]["count"],5);
        assert_eq!(days["native"][0]["lastCharge"],2);
    }

    #[test]
    fn first_connection_then_disconnect_and_reconnect_does_not_enroll_another_paired_pad() {
        let asleep = json!({"id":"win:b","art":"unknown","sample":{"status":"offline"}});
        let mut controller = json!({"id":"dualsense:a","art":"dualsense","aliases":["win:a"],"sample":{"status":"current","reading":{"low":70,"high":79,"power":"discharging"}}});
        let mut rows = vec![];
        for (status, expected_count) in [("current",1),("offline",1),("current",1)] {
            controller["sample"]["status"] = json!(status);
            let candidates = [asleep.clone(),controller.clone()];
            let owners=aliases(&candidates);
            let mut previous=std::mem::take(&mut rows);
            for candidate in &candidates {
                let id=candidate["id"].as_str().unwrap();
                let (known,_) = take_previous(&mut previous,id,&owners);
                if may_enroll(candidate,known.is_some(),false){rows.push(candidate.clone())}
            }
            assert_eq!(rows.len(),expected_count);
            assert_eq!(rows[0]["id"],"dualsense:a");
        }
    }
}
