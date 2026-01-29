use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

struct CurrentShortcut(Mutex<Option<Shortcut>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub provider: String,
    pub endpoint: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateResponse {
    pub translated_text: String,
    pub detected_lang: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

fn build_translation_prompt(text: &str, source_lang: &str, target_lang: &str) -> String {
    let source = if source_lang == "auto" {
        "the detected language".to_string()
    } else {
        source_lang.to_string()
    };

    format!(
        r#"You are a professional translator. Translate the following text from {} to {}.
Only output the translated text, nothing else. Do not include explanations or notes.

Text to translate:
{}"#,
        source, target_lang, text
    )
}

#[tauri::command]
async fn translate(request: TranslateRequest) -> Result<TranslateResponse, String> {
    let client = reqwest::Client::new();
    let prompt = build_translation_prompt(&request.text, &request.source_lang, &request.target_lang);

    let translated_text = if request.provider == "ollama" {
        let ollama_req = OllamaRequest {
            model: request.model.clone(),
            prompt,
            stream: false,
        };

        let response = client
            .post(format!("{}/api/generate", request.endpoint))
            .json(&ollama_req)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?
            .error_for_status()
            .map_err(|e| format!("API error: {}", e))?;

        let ollama_res: OllamaResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        ollama_res.response.trim().to_string()
    } else {
        // LM Studio / OpenAI compatible API
        let openai_req = OpenAIRequest {
            model: request.model.clone(),
            messages: vec![
                OpenAIMessage {
                    role: "system".to_string(),
                    content: "You are a professional translator. Only output the translated text, nothing else.".to_string(),
                },
                OpenAIMessage {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
            temperature: 0.3,
        };

        let response = client
            .post(format!("{}/v1/chat/completions", request.endpoint))
            .json(&openai_req)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {}", e))?
            .error_for_status()
            .map_err(|e| format!("API error: {}", e))?;

        let openai_res: OpenAIResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        openai_res
            .choices
            .first()
            .map(|c| c.message.content.trim().to_string())
            .unwrap_or_default()
    };

    Ok(TranslateResponse {
        translated_text,
        detected_lang: None,
    })
}

#[tauri::command]
async fn get_clipboard_text(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}

#[tauri::command]
async fn set_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))
}

fn parse_shortcut(shortcut_str: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();
    if parts.is_empty() {
        return Err("Empty shortcut string".to_string());
    }

    let mut modifiers = Modifiers::empty();
    let key_str = parts.last().unwrap().trim();

    for part in &parts[..parts.len() - 1] {
        match part.trim().to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::SUPER,
            _ => return Err(format!("Unknown modifier: {}", part)),
        }
    }

    let code = match key_str.to_uppercase().as_str() {
        "A" => Code::KeyA, "B" => Code::KeyB, "C" => Code::KeyC, "D" => Code::KeyD,
        "E" => Code::KeyE, "F" => Code::KeyF, "G" => Code::KeyG, "H" => Code::KeyH,
        "I" => Code::KeyI, "J" => Code::KeyJ, "K" => Code::KeyK, "L" => Code::KeyL,
        "M" => Code::KeyM, "N" => Code::KeyN, "O" => Code::KeyO, "P" => Code::KeyP,
        "Q" => Code::KeyQ, "R" => Code::KeyR, "S" => Code::KeyS, "T" => Code::KeyT,
        "U" => Code::KeyU, "V" => Code::KeyV, "W" => Code::KeyW, "X" => Code::KeyX,
        "Y" => Code::KeyY, "Z" => Code::KeyZ,
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2, "3" => Code::Digit3,
        "4" => Code::Digit4, "5" => Code::Digit5, "6" => Code::Digit6, "7" => Code::Digit7,
        "8" => Code::Digit8, "9" => Code::Digit9,
        "F1" => Code::F1, "F2" => Code::F2, "F3" => Code::F3, "F4" => Code::F4,
        "F5" => Code::F5, "F6" => Code::F6, "F7" => Code::F7, "F8" => Code::F8,
        "F9" => Code::F9, "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
        "SPACE" => Code::Space, "ENTER" => Code::Enter, "ESCAPE" => Code::Escape,
        "TAB" => Code::Tab, "BACKSPACE" => Code::Backspace, "DELETE" => Code::Delete,
        "HOME" => Code::Home, "END" => Code::End,
        "PAGEUP" => Code::PageUp, "PAGEDOWN" => Code::PageDown,
        "ARROWUP" => Code::ArrowUp, "ARROWDOWN" => Code::ArrowDown,
        "ARROWLEFT" => Code::ArrowLeft, "ARROWRIGHT" => Code::ArrowRight,
        "INSERT" => Code::Insert,
        _ => return Err(format!("Unknown key: {}", key_str)),
    };

    let mods = if modifiers.is_empty() { None } else { Some(modifiers) };
    Ok(Shortcut::new(mods, code))
}

fn register_translate_shortcut(
    app_handle: &tauri::AppHandle,
    shortcut: Shortcut,
) -> Result<(), String> {
    let handle = app_handle.clone();

    app_handle
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, _event| {
            let app_handle_inner = handle.clone();

            #[cfg(target_os = "windows")]
            {
                use std::process::Command;
                // モディファイアキーを全てリリースしてからCtrl+Cを送信
                let _ = Command::new("powershell")
                    .args(["-Command", r#"
                        Add-Type @"
                        using System;
                        using System.Runtime.InteropServices;
                        public class KeyHelper {
                            [DllImport("user32.dll")]
                            public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
                            public static void ReleaseModifiers() {
                                uint KEYUP = 0x0002;
                                keybd_event(0x10, 0, KEYUP, UIntPtr.Zero);
                                keybd_event(0x11, 0, KEYUP, UIntPtr.Zero);
                                keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
                                keybd_event(0x5B, 0, KEYUP, UIntPtr.Zero);
                            }
                            public static void SendCtrlC() {
                                keybd_event(0x11, 0, 0, UIntPtr.Zero);
                                keybd_event(0x43, 0, 0, UIntPtr.Zero);
                                uint KEYUP = 0x0002;
                                keybd_event(0x43, 0, KEYUP, UIntPtr.Zero);
                                keybd_event(0x11, 0, KEYUP, UIntPtr.Zero);
                            }
                        }
"@
                        [KeyHelper]::ReleaseModifiers()
                        [System.Threading.Thread]::Sleep(50)
                        [KeyHelper]::SendCtrlC()
                    "#])
                    .output();
            }

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                if let Some(window) = app_handle_inner.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    if let Ok(text) = app_handle_inner.clipboard().read_text() {
                        if !text.is_empty() {
                            let _ = window.emit("translate-selection", text);
                        }
                    }
                }
            });
        })
        .map_err(|e| format!("Failed to register shortcut: {}", e))
}

#[tauri::command]
async fn update_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    let new_shortcut = parse_shortcut(&shortcut)?;

    // 旧ショートカットを解除
    {
        let state = app.state::<CurrentShortcut>();
        let guard = state.0.lock().unwrap();
        if let Some(old) = *guard {
            let _ = app.global_shortcut().unregister(old);
        }
    }

    // 新ショートカットを登録
    register_translate_shortcut(&app, new_shortcut)?;

    // ステートを更新
    {
        let state = app.state::<CurrentShortcut>();
        let mut guard = state.0.lock().unwrap();
        *guard = Some(new_shortcut);
    }

    Ok(())
}

fn toggle_window(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // システムトレイアイコンのセットアップ
            let show_item = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隠す", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Translator")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
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
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            toggle_window(&window);
                        }
                    }
                })
                .build(app)?;

            app.manage(CurrentShortcut(Mutex::new(None)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            translate,
            get_clipboard_text,
            set_clipboard_text,
            update_shortcut
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
