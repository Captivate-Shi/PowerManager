#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{process::Command,sync::{Arc,atomic::{AtomicBool,AtomicU64,Ordering}},thread,time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};

type Reply = Result<Value, String>;
mod monitor_rust;
mod power_events;
mod tray_position;
mod tray_clicks;
mod main_frame;
mod toast_lifecycle;
use toast_lifecycle::ToastSlot;

static NEXT_TOAST_TICKET: AtomicU64 = AtomicU64::new(1);
static CLOSED_TOAST_TICKET: AtomicU64 = AtomicU64::new(0);
static TOAST_SLOT: std::sync::Mutex<Option<ToastSlot>> = std::sync::Mutex::new(None);

use monitor_rust::Bridge;

static TRAY_PINNED: AtomicBool = AtomicBool::new(false);
static TRAY_LIFETIME: AtomicU64 = AtomicU64::new(0);
static TRAY_BENCH: AtomicBool = AtomicBool::new(false);
const TRAY_KEEP_WARM: Duration = Duration::from_secs(8);

static TRAY_GESTURE: AtomicU64 = AtomicU64::new(0);
static MAIN_READY: AtomicBool = AtomicBool::new(false);
static MAIN_NAVIGATE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
static TRAY_READY: AtomicBool = AtomicBool::new(false);
static TRAY_ACCEPTED: AtomicBool = AtomicBool::new(false);
static TRAY_CLICKS: std::sync::Mutex<tray_clicks::TrayClicks> =
    std::sync::Mutex::new(tray_clicks::TrayClicks::new());

#[cfg(windows)]
#[link(name="user32")]
unsafe extern "system" {
    fn PostMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
}

fn tray_trace(name: &str, detail: Value) {
    if !TRAY_BENCH.load(Ordering::Acquire) { return; }
    if let Some(path) = std::env::var_os("PM_TEST_TRAY_TRACE") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            let _ = writeln!(f, "{}", json!({"event":name,"time":ms,"detail":detail}));
        }
    }
}

fn main_showing(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|w| !w.is_minimized().unwrap_or(false) && (w.is_visible().unwrap_or(false) || !MAIN_READY.load(Ordering::Acquire)))
}

fn reveal_tray(window: &tauri::WebviewWindow) -> Result<(), String> {
    if !TRAY_READY.load(Ordering::Acquire) || !TRAY_ACCEPTED.load(Ordering::Acquire) ||
        main_showing(window.app_handle()) || window.is_visible().unwrap_or(false) { return Ok(()); }
    window.show().map_err(|e| e.to_string())?;
    // Both the timer and renderer-ready paths commit the single here, not at 300 ms.
    TRAY_CLICKS.lock().unwrap().finish_pending();
    let _ = window.set_focus();
    let p = window.outer_position().ok().map(|p| [p.x, p.y]);
    tray_trace("show", json!(p));
    Ok(())
}

fn tray_interaction(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    let app = tray.app_handle();
    match event {
        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
            let elapsed = TRAY_CLICKS.lock().unwrap().double_click(std::time::Instant::now());
            tray_trace("double", json!({"accepted": elapsed.is_some(), "afterMs": elapsed.map(|t| t.as_millis() as u64)}));
            // The OS already classified this event; no second timing cutoff while the panel is hidden.
            if elapsed.is_some() { let _ = open(app, "main"); }
        }
        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, position, rect, .. } => {
            let anchor = tray_position::click_anchor(position, rect);
            let wait = tray_clicks::SINGLE_DELAY;
            tray_trace("up", json!({"cursor":[position.x, position.y],"anchor":[anchor.point.x,anchor.point.y],"waitMs":wait.as_millis() as u64}));
            if !TRAY_CLICKS.lock().unwrap().left_up(std::time::Instant::now()) { return; }
            if main_showing(app) || app.get_webview_window("tray").is_some_and(|w| w.is_visible().unwrap_or(false)) { return; }
            let ticket = TRAY_GESTURE.fetch_add(1, Ordering::AcqRel) + 1;
            let gui = app.clone();
            thread::spawn(move || {
                thread::sleep(wait);
                let a = gui.clone();
                let _ = gui.run_on_main_thread(move || {
                    if TRAY_GESTURE.load(Ordering::Acquire) == ticket && !main_showing(&a) {
                        let _ = open_at(&a, "tray", Some(anchor));
                    }
                });
            });
            // Prepare the WebView while Windows is still deciding if this is a double-click.
            // It stays hidden until both the single-click decision and renderer readiness.
            let _ = prepare_tray(app, Some(anchor));
        }
        _ => {}
    }
}

fn prepare_tray(app: &AppHandle, anchor: Option<tray_position::Anchor>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tray") {
        if !TRAY_PINNED.load(Ordering::Acquire) { tray_position::place(&window, anchor).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    build_surface(app, "tray", anchor)
}


fn hide_tray(window: &tauri::WebviewWindow) -> Result<(), String> {
    TRAY_ACCEPTED.store(false, Ordering::Release);
    if TRAY_PINNED.swap(false, Ordering::AcqRel) {
        return window.destroy().map_err(|e| e.to_string());
    }
    window.hide().map_err(|e| e.to_string())?;
    let ticket = TRAY_LIFETIME.fetch_add(1, Ordering::AcqRel) + 1;
    let app = window.app_handle().clone();
    let window = window.clone();
    thread::spawn(move || {
        thread::sleep(TRAY_KEEP_WARM);
        let _ = app.run_on_main_thread(move || {
            if TRAY_LIFETIME.load(Ordering::Acquire) == ticket && window.is_visible().is_ok_and(|v| !v) {
                let _ = window.destroy();
            }
        });
    });
    Ok(())
}

pub(crate) fn apply_settings(app:&AppHandle,settings:&Value){
    let values=[("main",settings["zoom"].as_u64().unwrap_or(100)),("tray",settings["trayZoom"].as_u64().unwrap_or(100))];
    let gui=app.clone();
    let _=app.run_on_main_thread(move||{
        for (label,v) in values{if let Some(w)=gui.get_webview_window(label){let _=w.set_zoom(v.clamp(75,150) as f64/100.);}}
    });
}

fn open(app: &AppHandle, label: &'static str) -> Result<(), String> {
    open_at(app, label, None)
}

fn open_at(app: &AppHandle, label: &'static str, anchor: Option<tray_position::Anchor>) -> Result<(), String> {
    if label == "tray" {
        if main_showing(app) { return Ok(()); }
        prepare_tray(app, anchor)?;
        if let Some(w) = app.get_webview_window("tray") {
            TRAY_LIFETIME.fetch_add(1, Ordering::AcqRel);
            TRAY_ACCEPTED.store(true, Ordering::Release);
            reveal_tray(&w)?;
        }
        return Ok(());
    }
    if label == "main" {
        TRAY_CLICKS.lock().unwrap().finish_pending();
        TRAY_GESTURE.fetch_add(1, Ordering::AcqRel);
        TRAY_LIFETIME.fetch_add(1, Ordering::AcqRel);
        TRAY_ACCEPTED.store(false, Ordering::Release);
        if let Some(w) = app.get_webview_window("tray") { w.destroy().map_err(|e| e.to_string())?; }
    }
    if let Some(window) = app.get_webview_window(label) {
        if label == "main" && MAIN_READY.load(Ordering::Acquire) { window.show().map_err(|e| e.to_string())?; let _ = window.unminimize(); let _ = window.set_focus(); }
        return Ok(());
    }
    build_surface(app, label, anchor)
}

fn new_toast_ticket() -> u64 { NEXT_TOAST_TICKET.fetch_add(1, Ordering::Relaxed) }
fn toast_closed(ticket: u64) -> bool { CLOSED_TOAST_TICKET.load(Ordering::Acquire) >= ticket }
fn mark_toast_closed(ticket: u64) { CLOSED_TOAST_TICKET.fetch_max(ticket, Ordering::AcqRel); }

// Create/show/close operations are serialized on the native UI thread. The ticket ties
// delayed callbacks and renderer IPC to the specific toast that created them.
fn open_toast(app: &AppHandle, ticket: u64, seconds: u64) {
    if toast_closed(ticket) { return; }
    let retiring = TOAST_SLOT.lock().unwrap().filter(|slot| slot.closing).map(|slot| slot.ticket);
    if let Some(retiring) = retiring { close_toast(app, retiring, false); }
    if app.get_webview_window("toast").is_some() {
        mark_toast_closed(ticket);
        return;
    }
    *TOAST_SLOT.lock().unwrap() = Some(ToastSlot::new(ticket, seconds));
    if build_surface_for(app, "toast", None, Some(ticket)).is_err() {
        close_toast(app, ticket, false);
        return;
    }
    let gui = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        let handle = gui.clone();
        let _ = gui.run_on_main_thread(move || close_toast(&handle, ticket, true));
    });
}

fn close_toast(app: &AppHandle, ticket: u64, only_if_hidden: bool) {
    if !TOAST_SLOT.lock().unwrap().is_some_and(|slot| slot.matches(ticket, only_if_hidden)) { return; }
    if let Some(window) = app.get_webview_window("toast") {
        if window.destroy().is_err() { return; }
    }
    *TOAST_SLOT.lock().unwrap() = None;
    mark_toast_closed(ticket);
}

fn present_toast(app: &AppHandle, ticket: u64) {
    if !TOAST_SLOT.lock().unwrap().is_some_and(|slot| slot.matches(ticket, true)) { return; }
    let Some(window) = app.get_webview_window("toast") else {
        close_toast(app, ticket, false);
        return;
    };
    if window.show().is_err() {
        close_toast(app, ticket, false);
        return;
    }
    let timer = TOAST_SLOT.lock().unwrap().as_mut()
        .and_then(|slot| slot.present().map(|duration| (slot.epoch, duration)));
    if let Some((epoch, duration)) = timer { arm_toast_timeout(app, ticket, epoch, duration); }
}

fn arm_toast_timeout(app: &AppHandle, ticket: u64, epoch: u64, duration: Duration) {
    let gui = app.clone();
    thread::spawn(move || {
        thread::sleep(duration);
        let handle = gui.clone();
        let _ = gui.run_on_main_thread(move || {
            if TOAST_SLOT.lock().unwrap().is_some_and(|slot| slot.timeout_matches(ticket, epoch)) {
                close_toast(&handle, ticket, false);
            }
        });
    });
}

fn update_toast(app: &AppHandle, ticket: u64, payload: Value, seconds: Option<u64>) {
    let timer = {
        let mut lock = TOAST_SLOT.lock().unwrap();
        let Some(slot) = lock.as_mut().filter(|slot| slot.ticket == ticket && !slot.closing) else { return; };
        seconds.and_then(|seconds| slot.restart(seconds).map(|duration| (slot.epoch, duration)))
    };
    if let Some(window) = app.get_webview_window("toast") { let _ = window.emit("pm-toast", payload); }
    if let Some((epoch, duration)) = timer { arm_toast_timeout(app, ticket, epoch, duration); }
}

fn retire_toast(app: &AppHandle, ticket: u64) {
    let presented = {
        let mut lock = TOAST_SLOT.lock().unwrap();
        let Some(slot) = lock.as_mut().filter(|slot| slot.ticket == ticket && !slot.closing) else { return; };
        slot.closing = true;
        slot.presented
    };
    if !presented { close_toast(app, ticket, false); return; }
    if let Some(window) = app.get_webview_window("toast") { let _ = window.emit("pm-toast", Value::Null); }
    let gui = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(175));
        let handle = gui.clone();
        let _ = gui.run_on_main_thread(move || close_toast(&handle, ticket, false));
    });
}

fn build_surface(app: &AppHandle, label: &'static str, anchor: Option<tray_position::Anchor>) -> Result<(), String> {
    build_surface_for(app, label, anchor, None)
}

fn build_surface_for(app: &AppHandle, label: &'static str, anchor: Option<tray_position::Anchor>, toast_ticket: Option<u64>) -> Result<(), String> {
    if label == "tray" {
        TRAY_READY.store(false, Ordering::Release);
        TRAY_ACCEPTED.store(false, Ordering::Release);
    }

    if label == "main" { MAIN_READY.store(false, Ordering::Release); }
    let (w, h) = match label { "main" => (1240.0, 820.0), "tray" => (420.0, 565.0), _ => (460.0, 146.0) };
    let query = toast_ticket.map(|ticket| format!("&ticket={ticket}")).unwrap_or_default();
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(format!("index.html?surface={label}{query}").into()))
        .title("余电").inner_size(w, h).visible(false)
        .on_navigation(|url| ((matches!(url.scheme(),"http"|"https")&&url.host_str()==Some("tauri.localhost"))||(url.scheme()=="tauri"&&url.host_str()==Some("localhost"))) && url.path()=="/index.html");
    if label != "main" { builder = builder.always_on_top(true).resizable(false).decorations(false).skip_taskbar(true); }
    if label=="main"{builder=builder.title("余电").decorations(false).center().background_color(tauri::window::Color(21, 24, 30, 255)).min_inner_size(720.0,520.0);}
    // On Windows, native shadows on frameless windows add a white outline.
    // Let each popup's CSS draw its own edges and rounded corners.
    if matches!(label, "tray" | "toast") {
        builder = builder.transparent(true).shadow(false);
    }
    if label == "toast" { builder = builder.focused(false); }
    let window = builder.build().map_err(|e| e.to_string())?;
    if let Some(ticket) = toast_ticket {
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) { mark_toast_closed(ticket); }
        });
    }
    if label == "main" {
        let w = window.clone();
        window.on_window_event(move |evt| {
            if matches!(evt, tauri::WindowEvent::CloseRequested { .. }) && MAIN_READY.load(Ordering::Acquire) {
                main_frame::remember(&w);
            }
        });
    }
    if label=="tray"{
        TRAY_PINNED.store(false,Ordering::Release);
        let w=window.clone();let app=app.clone();
        window.on_window_event(move |evt|{
            if matches!(evt,tauri::WindowEvent::Focused(false)) && !TRAY_PINNED.load(Ordering::Acquire) && !TRAY_BENCH.load(Ordering::Acquire){
                let w=w.clone();let gui=app.clone();
                thread::spawn(move||{
                    thread::sleep(Duration::from_millis(110));let h=gui.clone();
                    let _=gui.run_on_main_thread(move||{
                        if h.get_webview_window("tray").is_some()&&!TRAY_PINNED.load(Ordering::Acquire)&&!w.is_focused().unwrap_or(true)&&w.is_visible().unwrap_or(false){let _=hide_tray(&w);}
                    });
                });
            }
        });
    }
    if label == "tray" {
        if let Err(err) = tray_position::place(&window, anchor) {
            let _ = window.destroy();
            return Err(err.to_string());
        }
        let w = window.clone();
        let gui = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(5));
            let _ = gui.run_on_main_thread(move || {
                if w.is_visible().is_ok_and(|visible| !visible) && !TRAY_READY.load(Ordering::Acquire) {
                    let _ = w.destroy();
                }
            });
        });
    } else if label == "toast" {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let area = monitor.work_area();
            let size = window.outer_size().map_err(|e| e.to_string())?;
            let x = area.position.x + area.size.width.saturating_sub(size.width + 14) as i32;
            let y = area.position.y + area.size.height.saturating_sub(size.height + 14) as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    if label == "main" {
        let w = window.clone();
        let gui = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(8));
            let _ = gui.run_on_main_thread(move || {
                if w.is_visible().is_ok_and(|visible| !visible) && !MAIN_READY.load(Ordering::Acquire) {
                    let _ = w.destroy();
                    MAIN_NAVIGATE.lock().unwrap().take();
                }
            });
        });
    }
    Ok(())
}
#[tauri::command]
async fn desktop(window: tauri::WebviewWindow, method: String, data: Value) -> Reply {
    let label = window.label();
    if !matches!(label, "main" | "tray" | "toast") { return Err("无效窗口".into()); }
    let app = window.app_handle().clone();
    let state = app.state::<Arc<Bridge>>().inner().clone();
    let kind = data["type"].as_str().unwrap_or_default();
    let toast_ticket = if label == "toast" {
        let url = window.url().map_err(|e| e.to_string())?;
        Some(url.query_pairs().find(|(key, _)| key == "ticket")
            .and_then(|(_, value)| value.parse::<u64>().ok()).ok_or("提醒已失效")?)
    } else { None };
    match (label, method.as_str(), kind) {
        ("main","window-action",_)=>{
            match data.as_str(){
                Some("minimize")=>{ main_frame::remember(&window); window.minimize() },
                Some("maximize")=>if window.is_maximized().unwrap_or(false){window.unmaximize()}else{window.maximize()},
                Some("close")=>window.close(),
                Some("drag")=>window.start_dragging(),
                _=>return Err("Invalid window action".into())
            }.map_err(|e|e.to_string())?;
            return Ok(Value::Null);
        }
        ("main", "frame-test", _) if TRAY_BENCH.load(Ordering::Acquire) => {
            match kind {
                "move" => {
                    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("No monitor")?;
                    let area = monitor.work_area();
                    window.set_position(tauri::PhysicalPosition::new(area.position.x + 92, area.position.y + 83)).map_err(|e| e.to_string())?;
                    window.set_size(tauri::PhysicalSize::new(1140_u32, 810_u32)).map_err(|e| e.to_string())?;
                }
                "arm-reopen" => {
                    let gui = app.clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(850));
                        let a = gui.clone();
                        let _ = gui.run_on_main_thread(move || { let _ = open(&a, "main"); });
                    });
                }
                _ => {}
            }
            let p = window.outer_position().map_err(|e| e.to_string())?;
            let size = window.outer_size().map_err(|e| e.to_string())?;
            return Ok(json!({"x":p.x,"y":p.y,"w":size.width,"h":size.height,"max":window.is_maximized().map_err(|e| e.to_string())?}));
        }
        ("main","main-present",_) => {
            let _ = app.run_on_main_thread(move || {
                if window.is_visible().is_err() || MAIN_READY.load(Ordering::Acquire) { return; }
                tray_trace("main-ready", json!({"visibleBefore":window.is_visible().ok()}));
                if main_frame::restore_and_show(&window) || window.show().is_ok() {
                    MAIN_READY.store(true, Ordering::Release);
                    let _ = window.set_focus();
                    tray_trace("main-show", Value::Null);
                    if let Some(id) = MAIN_NAVIGATE.lock().unwrap().take() { let _ = window.emit("pm-navigate", id); }
                }
            });
            return Ok(Value::Null);
        }
        ("tray","tray-present",_) => {
            let _ = app.run_on_main_thread(move || {
                if window.is_visible().is_err() { return; }
                TRAY_READY.store(true, Ordering::Release);
                tray_trace("ready", Value::Null);
                let _ = reveal_tray(&window);
            });
            return Ok(Value::Null);
        }
        ("toast", "toast-present", _) => {
            let ticket = toast_ticket.unwrap();
            let gui = app.clone();
            app.run_on_main_thread(move || present_toast(&gui, ticket)).map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        ("toast", "toast", _) => {
            return tauri::async_runtime::spawn_blocking(move || state.request("toast", json!(toast_ticket)))
                .await.map_err(|_| String::from("实验后端异常"))?;
        }
        (_, "snapshot", _) | ("main", "view" | "remember" | "evidence" | "test-power", _) => {}
        ("tray", "tray-test", _) if TRAY_BENCH.load(Ordering::Acquire) => {
            let reopen = kind == "reopen";
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            let gui = app.clone();
            app.run_on_main_thread(move || {
                let result = (|| {
                    if reopen {
                        let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("No monitor")?;
                        let area = monitor.work_area();
                        let px = area.position.x as f64 + area.size.width as f64 * 0.4;
                        let py = area.position.y as f64 + area.size.height as f64;
                        open_at(&gui, "tray", Some(tray_position::Anchor::from_point(px, py)))?;
                    }
                    let p = window.outer_position().map_err(|e| e.to_string())?;
                    Ok(json!({"visible":window.is_visible().map_err(|e| e.to_string())?,"x":p.x,"y":p.y}))
                })();
                let _ = tx.send(result);
            }).map_err(|e| e.to_string())?;
            return tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(3)).map_err(|e| e.to_string())?)
                .await.map_err(|e| e.to_string())?;
        }
        ("tray", "command", "pin") => {
            let pinned=!TRAY_PINNED.load(Ordering::Acquire);
            window.set_resizable(pinned).map_err(|e|e.to_string())?;
            TRAY_PINNED.store(pinned,Ordering::Release);
            return Ok(json!({"ok":true,"pinned":pinned}));
        }
        ("tray", "command", "closeSurface") => {
            hide_tray(&window)?;
            return Ok(json!({"ok":true}));
        }
        ("toast", "command", "closeSurface") => {
            let ticket = toast_ticket.unwrap();
            let gui = app.clone();
            app.run_on_main_thread(move || close_toast(&gui, ticket, false)).map_err(|e| e.to_string())?;
            return Ok(json!({"ok":true}));
        }
        (_, "command", "open") => {
            let gui = app.clone();
            let id = if data["destination"] == "pendingCharge" { Some(":pending-charge".to_owned()) }
                else { data["id"].as_str().map(|s| s.to_owned()) };
            app.run_on_main_thread(move || {
                if let Some(ticket) = toast_ticket {
                    if !TOAST_SLOT.lock().unwrap().is_some_and(|slot| slot.matches(ticket, false)) { return; }
                    close_toast(&gui, ticket, false);
                }
                if open(&gui, "main").is_ok() {
                    if let Some(id) = id {
                        if MAIN_READY.load(Ordering::Acquire) { let _ = gui.emit("pm-navigate", id); }
                        else { *MAIN_NAVIGATE.lock().unwrap() = Some(id); }
                    }
                }
            }).map_err(|e| e.to_string())?;
            return Ok(json!({"ok":true}));
        }
        ("main", "command", "revealCompatibility") => {
            monitor_rust::reveal_report(&state.directory, data["reportName"].as_str().unwrap_or_default())?;
            return Ok(json!({"ok":true}));
        }
        ("main", "command", "diagnostics") => {
            #[cfg(windows)]
            Command::new("explorer.exe").arg(&state.directory).spawn().map_err(|e| e.to_string())?;
            return Ok(json!({"ok":true}));
        }
        ("main", "command", "refresh" | "discover" | "add" | "remove" | "history" |
         "deviceSettings" | "toggleAlertSetting" | "settings" | "diagnosticDevices" |
         "diagnosticFirmware" | "compatibility" | "mute" | "preview" | "snooze" | "ignore") |
        ("tray", "command", "refresh" | "mute") |
        ("toast", "command", "snooze" | "ignore") => {}
        _ => return Err("该动作在实验版中不可用".into()),
    }
    let snapshot = method=="snapshot";
    let reply=tauri::async_runtime::spawn_blocking(move || state.request(&method, data))
        .await.map_err(|_| String::from("实验后端异常"))?;
    if snapshot{if let Ok(v)=&reply{apply_settings(&app,&v["settings"]);}}
    reply
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let background = args.iter().any(|arg| arg == "--background");
    let benchmark = args.iter().any(|arg| arg == "--benchmark");
    let benchmark_tray = benchmark && args.iter().any(|arg| arg == "--benchmark-tray");
    #[cfg(windows)] let native_tray_test = if benchmark && background {
        match std::env::var("PM_TEST_TRAY_NOTIFICATION").as_deref() { Ok("single") => Some(0), Ok("double") => Some(110), Ok("late") => Some(385), _ => None }
    } else { None };
    let import=args.iter().any(|arg|arg=="--import-electron-profile");
    let app = tauri::Builder::default().setup(move |app| {
        let bridge = Bridge::launch(app.handle(), benchmark, import)?;
        app.manage(bridge);
        let show = MenuItem::with_id(app, "show", "打开余电", true, None::<&str>)?;
        let close = MenuItem::with_id(app, "quit", "退出余电", true, None::<&str>)?;
        let panel=MenuItem::with_id(app,"tray-panel","托盘面板",true,None::<&str>)?;
        let preview=MenuItem::with_id(app,"preview","测试右下角提醒",true,None::<&str>)?;
        let refresh=MenuItem::with_id(app,"refresh","立即刷新",true,None::<&str>)?;
        let mute=MenuItem::with_id(app,"mute","静音 / 恢复提醒",true,None::<&str>)?;
        let diagnose=MenuItem::with_id(app,"diagnostics","打开日志目录",true,None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &panel, &preview, &refresh, &mute, &diagnose, &close])?;
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico"))?;
        let icon = TrayIconBuilder::with_id("pm-tray").icon(icon).tooltip("余电")
            .menu(&menu).show_menu_on_left_click(false).on_menu_event(|app, e| match e.id().0.as_str() {
                "show" => { let _ = open(app, "main"); },
                "tray-panel" => {
                    let anchor = app.tray_by_id("pm-tray").and_then(|tray| tray.rect().ok().flatten()).and_then(tray_position::icon_anchor);
                    let _ = open_at(app, "tray", anchor);
                }
                "preview"|"refresh"|"mute"=>{
                    let kind=e.id().0.clone();let bridge=app.state::<Arc<Bridge>>().inner().clone();
                    thread::spawn(move||{let _=bridge.request("command",json!({"type":kind,"severity":"low"}));});
                }
                "diagnostics"=>{let bridge=app.state::<Arc<Bridge>>();let _=Command::new("explorer.exe").arg(&bridge.directory).spawn();}
                "quit" => app.exit(0),
                _ => {}
            }).on_tray_icon_event(tray_interaction).build(app)?;
        #[cfg(windows)]
        if let Some(mode) = native_tray_test {
            TRAY_BENCH.store(true, Ordering::Release);
            let hwnd = icon.with_inner_tray_icon(|inner| inner.window_handle() as isize)?;
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(400));
                // Exercise the registered Windows tray callback of this test process only.
                unsafe { let _ = PostMessageW(hwnd, 6002, 0, 0x0202); }
                if mode > 0 {
                    thread::sleep(Duration::from_millis(mode));
                    unsafe {
                        let _ = PostMessageW(hwnd, 6002, 0, 0x0203);
                        let _ = PostMessageW(hwnd, 6002, 0, 0x0202);
                    }
                }
            });
        }
        if benchmark_tray { TRAY_BENCH.store(true, Ordering::Release); open(app.handle(), "tray")?; } else if !background { open(app.handle(), "main")?; }
        Ok(())
    }).invoke_handler(tauri::generate_handler![desktop])
        .build(tauri::generate_context!()).expect("PowerManager Tauri lab startup");
    let _power_watch = power_events::Watch::register();
    app.run(|app, event| match event {
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(state) = app.try_state::<Arc<Bridge>>() { state.stop(); }
        }
        _ => {}
    });
}
