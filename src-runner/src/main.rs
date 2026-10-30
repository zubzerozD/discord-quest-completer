//! Dummy game runner for Discord quest detection.
//!
//! Discord detects "playing" by matching the running process's executable
//! name against its verified-games list, so at runtime this binary is renamed
//! to the target game's real executable name (e.g. `overwatch.exe`) and placed
//! under `games/<app_id>/`. It creates one real (hidden) Win32 window and pumps
//! messages until the process is terminated by PID from the main app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Extracts the window title from `--title <name>` args.
/// Returns None when the flag or its value is missing.
fn parse_title(args: &[String]) -> Option<String> {
    let flag_position = args.iter().position(|arg| arg == "--title")?;
    let value = args.get(flag_position + 1)?;
    if value.is_empty() {
        return None;
    }
    Some(value.clone())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let title = parse_title(&args).unwrap_or_else(|| "Game".to_string());
    unsafe { run_window(&title) }
}

/// Creates one real Win32 window (hidden — the main app manages lifetime by
/// PID) and blocks in the message loop until the process is terminated.
unsafe fn run_window(title: &str) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostQuitMessage,
        RegisterClassW, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT,
        MSG, SW_SHOWNOACTIVATE, WNDCLASSW, WM_DESTROY, WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    let hinstance = GetModuleHandleW(std::ptr::null());
    let class_name: Vec<u16> = "DQCRunner\0".encode_utf16().collect();
    let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();

    let wc = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hCursor: std::ptr::null_mut(),
        hIcon: std::ptr::null_mut(),
        hbrBackground: std::ptr::null_mut(),
        lpszMenuName: std::ptr::null(),
        lpszClassName: class_name.as_ptr(),
    };
    RegisterClassW(&wc);

    let hwnd = CreateWindowExW(
        0,
        class_name.as_ptr(),
        title_w.as_ptr(),
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        hinstance,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        std::process::exit(1);
    }
    // Visible (like the proven upstream runner — Discord's detection details
    // are unverified, so we keep a real shown window) but never activated, so
    // launching a "game" doesn't steal focus from the user. Closing the window
    // quits the loop, giving users a manual escape hatch; the main app still
    // owns normal lifetime and closes us by PID when the quest timer ends.
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);

    let mut msg = MSG {
        hwnd: std::ptr::null_mut(),
        message: 0,
        wParam: 0,
        lParam: 0,
        time: 0,
        pt: windows_sys::Win32::Foundation::POINT { x: 0, y: 0 },
    };
    while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

#[cfg(test)]
mod tests {
    use super::parse_title;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn extracts_title_after_flag() {
        assert_eq!(
            parse_title(&args(&["runner.exe", "--title", "Overwatch"])),
            Some("Overwatch".to_string())
        );
    }

    #[test]
    fn supports_title_value_with_spaces() {
        assert_eq!(
            parse_title(&args(&["runner.exe", "--title", "Call of Duty"])),
            Some("Call of Duty".to_string())
        );
    }

    #[test]
    fn missing_value_returns_none() {
        assert_eq!(parse_title(&args(&["runner.exe", "--title"])), None);
    }

    #[test]
    fn absent_flag_returns_none() {
        assert_eq!(parse_title(&args(&["runner.exe"])), None);
    }
}
