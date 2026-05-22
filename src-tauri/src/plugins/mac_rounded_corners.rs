// Unterdrücke Warnings von veralteten Cocoa APIs
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSWindow, NSWindowStyleMask, NSView, NSWindowTitleVisibility},
    base::id,
    foundation::NSPoint,
};

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

/// Configuration for Traffic Lights positioning
pub struct TrafficLightsConfig {
    /// Offset in pixels from default position (positive = right, negative = left)
    pub offset_x: f64,
    /// Offset in pixels from default position (positive = down, negative = up)
    pub offset_y: f64,
}

impl Default for TrafficLightsConfig {
    fn default() -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
        }
    }
}

/// Enables rounded corners for the window (macOS only)
/// Uses only public APIs - App Store compatible
#[tauri::command]
pub fn enable_rounded_corners<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    let mut style_mask = ns_window.styleMask();

                    // Add necessary styles for rounded corners
                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    style_mask |= NSWindowStyleMask::NSTitledWindowMask;
                    style_mask |= NSWindowStyleMask::NSResizableWindowMask;

                    // Only add traffic light masks if decorations are NOT disabled
                    // Check if decorations are enabled by examining the style mask
                    let has_decorations = style_mask.contains(NSWindowStyleMask::NSClosableWindowMask);

                    if has_decorations {
                        // Only add traffic lights if window has decorations
                        style_mask |= NSWindowStyleMask::NSClosableWindowMask;
                        style_mask |= NSWindowStyleMask::NSMiniaturizableWindowMask;
                    }
                    // If decorations are disabled (no close/minimize buttons), don't add them

                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);

                    let content_view = ns_window.contentView();
                    content_view.setWantsLayer(cocoa::base::YES);

                    if has_decorations {
                        position_traffic_lights(ns_window, offset_x.unwrap_or(0.0), offset_y.unwrap_or(0.0));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Enables modern window style with rounded corners and shadow
#[tauri::command]
pub fn enable_modern_window_style<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    corner_radius: Option<f64>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    let radius = corner_radius.unwrap_or(12.0);
    let _ = (offset_x, offset_y);

    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    let mut style_mask = ns_window.styleMask();

                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    style_mask |= NSWindowStyleMask::NSResizableWindowMask;

                    // Force remove traffic light masks to hide system window buttons
                    // regardless of initial window decoration state
                    style_mask &= !(NSWindowStyleMask::NSClosableWindowMask | NSWindowStyleMask::NSMiniaturizableWindowMask);

                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
                    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                    ns_window.setHasShadow_(cocoa::base::YES);
                    ns_window.setOpaque_(cocoa::base::NO);

                    // Also explicitly hide the traffic light button views
                    let close_button: id = msg_send![ns_window, standardWindowButton: 0];
                    let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1];
                    let zoom_button: id = msg_send![ns_window, standardWindowButton: 2];
                    if !close_button.is_null() {
                        let _: () = msg_send![close_button, setHidden: cocoa::base::YES];
                    }
                    if !miniaturize_button.is_null() {
                        let _: () = msg_send![miniaturize_button, setHidden: cocoa::base::YES];
                    }
                    if !zoom_button.is_null() {
                        let _: () = msg_send![zoom_button, setHidden: cocoa::base::YES];
                    }

                    let content_view = ns_window.contentView();
                    content_view.setWantsLayer(cocoa::base::YES);

                    let layer: id = msg_send![content_view, layer];
                    if !layer.is_null() {
                        let _: () = msg_send![layer, setCornerRadius: radius];
                        let _: () = msg_send![layer, setMasksToBounds: cocoa::base::YES];
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_BORDER_COLOR};
        use windows::Win32::Foundation::HWND;
        
        window
            .with_webview(move |webview| {
                #[cfg(target_os = "windows")]
                unsafe {
                    let hwnd = HWND(webview.hwnd() as _);
                    
                    let dark_mode: u32 = 1;
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_USE_IMMERSIVE_DARK_MODE,
                        &dark_mode as *const _ as *const _,
                        std::mem::size_of::<u32>() as u32,
                    );
                    
                    let corner_preference: u32 = if radius > 12.0 { 2 } else { 3 };
                    
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &corner_preference as *const _ as *const _,
                        std::mem::size_of::<u32>() as u32,
                    );

                    let border_color: u32 = 0xFFFFFFFF;
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_BORDER_COLOR,
                        &border_color as *const _ as *const _,
                        std::mem::size_of::<u32>() as u32,
                    );
                }
            })
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        // Linux 圆角通过 CSS 实现，在 Tauri 配置中已经设置了 transparent: true
        // CSS 会在前端处理圆角
    }
    
    Ok(())
}

/// Repositions Traffic Lights only (useful after fullscreen toggle)
#[tauri::command]
pub fn reposition_traffic_lights<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let config = TrafficLightsConfig {
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
        };

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    // Only reposition traffic lights if decorations are enabled
                    let style_mask = ns_window.styleMask();
                    if style_mask.contains(NSWindowStyleMask::NSClosableWindowMask) {
                        position_traffic_lights(ns_window, config.offset_x, config.offset_y);
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Set Dock icon visibility - now implemented in lib.rs via set_dock_icon_visibility_inner
/// These stubs are kept for backwards compatibility but are no longer called from lib.rs
#[cfg(target_os = "macos")]
pub unsafe fn set_dock_icon_visibility_impl(visible: bool) -> Result<(), String> {
    let ns_app_class = objc::runtime::Class::get("NSApplication")
        .ok_or_else(|| "NSApplication class not found".to_string())?;
    let app: id = msg_send![ns_app_class, sharedApplication];
    if app.is_null() {
        return Err("sharedApplication returned nil".to_string());
    }
    let policy: i64 = if visible { 0 } else { 1 };
    let _: () = msg_send![app, setActivationPolicy: policy];
    if visible {
        let current_icon: id = msg_send![app, applicationIconImage];
        let _: () = msg_send![app, setApplicationIconImage: current_icon];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub unsafe fn set_dock_icon_visibility_impl(_visible: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn position_traffic_lights(ns_window: id, offset_x: f64, offset_y: f64) {
    let default_x = 20.0;
    let default_y = 0.0;
    
    let close_button: id = msg_send![ns_window, standardWindowButton: 0];
    let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1];
    let zoom_button: id = msg_send![ns_window, standardWindowButton: 2];
    
    let new_x = default_x + offset_x;
    let new_y = default_y - offset_y;
    
    if !close_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![close_button, frame];
        let new_frame = cocoa::foundation::NSRect::new(
            NSPoint::new(new_x, new_y),
            frame.size,
        );
        let _: () = msg_send![close_button, setFrame: new_frame];
    }
    
    if !miniaturize_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![miniaturize_button, frame];
        let new_frame = cocoa::foundation::NSRect::new(
            NSPoint::new(new_x + 20.0, new_y),
            frame.size,
        );
        let _: () = msg_send![miniaturize_button, setFrame: new_frame];
    }
    
    if !zoom_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![zoom_button, frame];
        let new_frame = cocoa::foundation::NSRect::new(
            NSPoint::new(new_x + 40.0, new_y),
            frame.size,
        );
        let _: () = msg_send![zoom_button, setFrame: new_frame];
    }
}
