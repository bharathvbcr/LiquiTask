//! System tray for monitoring active agent runs while the window is closed.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent,
};

const TRAY_ID: &str = "main";

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_i = MenuItem::with_id(app, "open", "Open LiquiTask", true, None::<&str>)?;
    let view_runs_i = MenuItem::with_id(app, "view_runs", "View agent runs", true, None::<&str>)?;
    let cancel_all_i = MenuItem::with_id(app, "cancel_all", "Cancel all runs", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit LiquiTask", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&open_i, &view_runs_i, &cancel_all_i, &separator, &quit_i],
    )?;

    let icon = app
        .default_window_icon()
        .ok_or("Missing default window icon")?
        .clone();

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("LiquiTask — no active agent runs")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main_window(app),
            "view_runs" => {
                focus_main_window(app);
                let _ = app.emit("tray-view-runs", ());
            }
            "cancel_all" => {
                let _ = app.emit("tray-cancel-all", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                focus_main_window(&app);
            }
        })
        .build(app)?;

    Ok(())
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn tray_update_active_runs(app: AppHandle, count: u32) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not initialized".to_string())?;
    let label = if count == 0 {
        "LiquiTask — no active agent runs".to_string()
    } else if count == 1 {
        "LiquiTask — 1 active agent run".to_string()
    } else {
        format!("LiquiTask — {count} active agent runs")
    };
    tray.set_tooltip(Some(label))
        .map_err(|e| format!("Failed to update tray tooltip: {e}"))
}

/// v3 shell: reflects the Inbox's actionable count (approvals awaiting review +
/// blocked runs) rather than raw active-run count — this is what the tray badge
/// should communicate once Inbox is the primary surface (Rework Plan §3.5).
#[tauri::command(rename_all = "camelCase")]
pub fn tray_update_inbox_count(app: AppHandle, count: u32) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not initialized".to_string())?;
    let label = if count == 0 {
        "LiquiTask — you're all caught up".to_string()
    } else if count == 1 {
        "LiquiTask — 1 item needs your attention".to_string()
    } else {
        format!("LiquiTask — {count} items need your attention")
    };
    tray.set_tooltip(Some(label))
        .map_err(|e| format!("Failed to update tray tooltip: {e}"))
}

pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
            api.prevent_exit();
        }
    }
}
