use std::{ffi::c_void, iter, os::windows::ffi::OsStrExt, process::Command};

const ROOT: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const NAME: &str = "PowerManagerWebView2";

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegGetValueW(
        key: isize, subkey: *const u16, value: *const u16, flags: u32,
        kind: *mut u32, data: *mut c_void, size: *mut u32,
    ) -> i32;
}

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(iter::once(0)).collect() }

fn registered() -> Result<Option<Vec<u16>>, String> {
    const HKCU: isize = 0x8000_0001u32 as i32 as isize;
    const SZ: u32 = 2;
    let subkey = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let name = wide(NAME);
    let mut buf = vec![0u16; 32_768];
    let mut size = (buf.len() * 2) as u32;
    // A single wide-character read avoids depending on the reg.exe console code page.
    let status = unsafe {
        RegGetValueW(HKCU, subkey.as_ptr(), name.as_ptr(), SZ,
            std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size)
    };
    match status {
        0 if size >= 2 && size % 2 == 0 => {
            buf.truncate((size / 2) as usize - 1);
            Ok(Some(buf))
        }
        2 | 3 => Ok(None),
        _ => Err(format!("Windows 无法读取登录启动设置（{status}）")),
    }
}

fn query() -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("reg.exe");
    command.creation_flags(0x08000000);
    command
}

fn expected() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = String::from_utf16(&exe.as_os_str().encode_wide().collect::<Vec<_>>())
        .map_err(|_| "程序路径不是可识别的 Windows 字符串".to_string())?;
    Ok(format!("\"{path}\" --background"))
}

fn matches_command(value: &[u16], expected: &str) -> bool {
    String::from_utf16(value).is_ok_and(|value| value.eq_ignore_ascii_case(expected))
}

pub fn enabled() -> bool {
    let Ok(expected) = expected() else { return false };
    registered().ok().flatten().is_some_and(|value| matches_command(&value, &expected))
}

pub fn set(value: bool) -> Result<(), String> {
    let expected = expected()?;
    let owned = registered()?.map(|entry| matches_command(&entry, &expected));
    let mut command = query();
    match (value, owned) {
        (true, Some(true)) | (false, None | Some(false)) => return Ok(()),
        (true, Some(false)) => return Err("登录启动项属于另一处实验安装，请先关闭该安装的自启".into()),
        (true, None) => { command.args(["add", ROOT, "/v", NAME, "/t", "REG_SZ", "/d", &expected, "/f"]); }
        (false, Some(true)) => { command.args(["delete", ROOT, "/v", NAME, "/f"]); }
    }
    let result = command.output().map_err(|e| e.to_string())?;
    let observed = registered()?;
    if !result.status.success()
        || (value && !observed.as_ref().is_some_and(|item| matches_command(item, &expected)))
        || (!value && observed.is_some()) {
        return Err("Windows 登录启动设置未保存".into())
    }
    Ok(())
}
