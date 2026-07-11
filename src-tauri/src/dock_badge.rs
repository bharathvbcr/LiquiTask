//! macOS Dock badge (numeric count on the app icon).

#[cfg(target_os = "macos")]
pub fn set_dock_badge(count: u32) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let tile = app.dockTile();
    if count == 0 {
        tile.setBadgeLabel(None);
    } else {
        let label = NSString::from_str(&count.to_string());
        tile.setBadgeLabel(Some(&label));
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_dock_badge(_count: u32) {}
