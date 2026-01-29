use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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

            // グローバルショートカット (Ctrl+Shift+T)
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT);
            let app_handle = app.handle().clone();

            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                let app_handle_inner = app_handle.clone();

                // 選択テキストをコピーするためにCtrl+Cをシミュレート
                #[cfg(target_os = "windows")]
                {
                    use std::process::Command;
                    // PowerShellでCtrl+Cキーストロークを送信
                    let _ = Command::new("powershell")
                        .args(["-Command", r#"
                            Add-Type -AssemblyName System.Windows.Forms
                            [System.Windows.Forms.SendKeys]::SendWait('^c')
                        "#])
                        .output();
                }

                // 少し待ってからクリップボードを読み取り
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));

                    if let Some(window) = app_handle_inner.get_webview_window("main") {
                        // ウィンドウを表示
                        let _ = window.show();
                        let _ = window.set_focus();

                        // クリップボードからテキストを取得してフロントエンドに送信
                        use tauri_plugin_clipboard_manager::ClipboardExt;
                        if let Ok(text) = app_handle_inner.clipboard().read_text() {
                            if !text.is_empty() {
                                let _ = window.emit("translate-selection", text);
                            }
                        }
                    }
                });
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            translate,
            get_clipboard_text,
            set_clipboard_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
