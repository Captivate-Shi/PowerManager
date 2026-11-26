use tauri::WebviewWindow;

#[cfg(windows)]
mod implementation {
    use super::*;
    use std::sync::Mutex;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SetWindowPlacement, WINDOWPLACEMENT, SW_HIDE, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWNORMAL,
    };

    static LAST_FRAME: Mutex<Option<WINDOWPLACEMENT>> = Mutex::new(None);

    pub fn remember(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else { return; };
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        if unsafe { GetWindowPlacement(hwnd.0 as _, &mut placement) } == 0 { return; }
        let rect = placement.rcNormalPosition;
        if rect.right <= rect.left || rect.bottom <= rect.top { return; }
        let mut saved = LAST_FRAME.lock().unwrap();
        if placement.showCmd == SW_SHOWMINIMIZED as u32 {
            placement.showCmd = saved.as_ref().map_or(SW_SHOWNORMAL as u32, |prior| prior.showCmd);
        }
        *saved = Some(placement);
    }

    pub fn restore_and_show(window: &WebviewWindow) -> bool {
        let Ok(hwnd) = window.hwnd() else { return false; };
        let Some(mut placement) = *LAST_FRAME.lock().unwrap() else { return false; };
        // A placement rectangle is in Windows workspace coordinates, not screen coordinates.
        // Restore with the paired API, which also relocates a fully off-screen placement.
        let maximized = placement.showCmd == SW_SHOWMAXIMIZED as u32;
        placement.flags = 0;
        placement.showCmd = SW_HIDE as u32;
        if unsafe { SetWindowPlacement(hwnd.0 as _, &placement) } == 0 { return false; }
        // Restore the normal rectangle while hidden so maximizing cannot replace it
        // with the newly created window's default normal rectangle.
        if maximized { let _ = window.maximize(); }
        window.show().is_ok()
    }
}
#[cfg(not(windows))]
mod implementation {
    use super::*;
    pub fn remember(_: &WebviewWindow) {}
    pub fn restore_and_show(_: &WebviewWindow) -> bool { false }
}
pub use implementation::*;
