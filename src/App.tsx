import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Markdown from "react-markdown";
import "./App.css";

interface Settings {
  provider: "ollama" | "lmstudio";
  endpoint: string;
  model: string;
  targetLang: string;
  shortcut: string;
}

interface TranslateResponse {
  translated_text: string;
  detected_lang: string | null;
}

interface HistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  targetLang: string;
  timestamp: number;
}

const LANGUAGES = [
  { code: "Japanese", label: "日本語" },
  { code: "English", label: "English" },
  { code: "Chinese", label: "中文" },
  { code: "Korean", label: "한국어" },
  { code: "French", label: "Français" },
  { code: "German", label: "Deutsch" },
  { code: "Spanish", label: "Español" },
];

const isMac = navigator.platform.toUpperCase().includes("MAC");

const DEFAULT_SETTINGS: Settings = {
  provider: "ollama",
  endpoint: "http://localhost:11434",
  model: "llama3",
  targetLang: "Japanese",
  shortcut: isMac ? "Super+Alt+L" : "Ctrl+Alt+L",
};

function mapKeyToShortcutString(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.charAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charAt(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const specialMap: Record<string, string> = {
    Space: "Space", Enter: "Enter", Backspace: "Backspace", Tab: "Tab",
    Escape: "Escape", Delete: "Delete", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Insert: "Insert",
  };
  return specialMap[code] || null;
}

function formatShortcutDisplay(shortcut: string): string {
  return shortcut.split("+").map((part) => {
    if (isMac) {
      switch (part) {
        case "Super": return "⌘";
        case "Ctrl": return "⌃";
        case "Alt": return "⌥";
        case "Shift": return "⇧";
        default: return part;
      }
    }
    if (part === "Super") return "Win";
    return part;
  }).join(isMac ? "" : " + ");
}

// Icons as SVG components
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v6m0 6v10M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m6 0h10M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const PasteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const TranslateIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 8l6 6"/>
    <path d="M4 14l6-6 2-3"/>
    <path d="M2 5h12"/>
    <path d="M7 2v3"/>
    <path d="M22 22l-5-10-5 10"/>
    <path d="M14 18h6"/>
  </svg>
);

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const ErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

const SunIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const HistoryIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);

const BookOpenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>
);

const NA_PATTERNS = /^[-*]?\s*(該当なし|特にありません|特になし|なし|ありません|N\/?A|None|No .+ found|No .+ detected)\.?\s*$/i;

function filterEmptySections(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (/^##\s+/.test(lines[i])) {
      const heading = lines[i];
      const sectionLines: string[] = [];
      i++;
      while (i < lines.length && !/^##\s+/.test(lines[i])) {
        sectionLines.push(lines[i]);
        i++;
      }
      const contentLines = sectionLines.filter((l) => l.trim() !== "");
      const allNA = contentLines.length === 0 || contentLines.every((l) => NA_PATTERNS.test(l.trim()));
      if (!allNA) {
        result.push(heading, ...sectionLines);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n").trim();
}

function App() {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem("translator-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [isCapturingShortcut, setIsCapturingShortcut] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("translator-theme") as "light" | "dark") || "light";
  });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem("translator-history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [explanationText, setExplanationText] = useState("");
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [isExplanationLoading, setIsExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isExplanationCancelling, setIsExplanationCancelling] = useState(false);
  const explanationCacheRef = useRef<{ source: string; explanation: string } | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("translator-theme", theme);
  }, [theme]);

  // 自動起動の状態を読み込む
  useEffect(() => {
    invoke<boolean>("get_autostart_enabled")
      .then(setAutostartEnabled)
      .catch((e) => console.error("Failed to get autostart status:", e));
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const toggleAutostart = async () => {
    const newValue = !autostartEnabled;
    try {
      await invoke("set_autostart_enabled", { enabled: newValue });
      setAutostartEnabled(newValue);
    } catch (e) {
      setError(`自動起動の設定に失敗しました: ${e}`);
    }
  };

  // 自動翻訳用のフラグ
  const pendingTranslateRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("translator-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("translator-history", JSON.stringify(history));
  }, [history]);

  // 起動時にグローバルショートカットを登録
  useEffect(() => {
    invoke("update_shortcut", { shortcut: settings.shortcut }).catch((e) =>
      console.error("Failed to register initial shortcut:", e)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // キャプチャモード中はwindowレベルでキーイベントを監視
  useEffect(() => {
    if (!isCapturingShortcut) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const modifierKeys = ["Control", "Shift", "Alt", "Meta"];
      if (modifierKeys.includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      if (e.metaKey) parts.push("Super");

      const keyName = mapKeyToShortcutString(e.code);
      if (!keyName) return;

      parts.push(keyName);
      const shortcutStr = parts.join("+");

      setIsCapturingShortcut(false);

      invoke("update_shortcut", { shortcut: shortcutStr })
        .then(() => setSettings((prev) => ({ ...prev, shortcut: shortcutStr })))
        .catch((err) => setError(`ショートカットの設定に失敗しました: ${err}`));
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isCapturingShortcut]);

  const addToHistory = useCallback((sourceText: string, translatedText: string, targetLang: string) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      sourceText,
      translatedText,
      targetLang,
      timestamp: Date.now(),
    };
    setHistory((prev) => [newItem, ...prev].slice(0, 50)); // 最大50件
  }, []);

  const handleTranslate = useCallback(async (textToTranslate?: string) => {
    const text = textToTranslate || sourceText;
    if (!text.trim()) return;

    setIsLoading(true);
    setError(null);
    setTranslatedText("");
    setExplanationText("");
    setIsExplanationOpen(false);
    setExplanationError(null);
    explanationCacheRef.current = null;

    try {
      const response = await invoke<TranslateResponse>("translate", {
        request: {
          text: text,
          source_lang: "auto",
          target_lang: settings.targetLang,
          provider: settings.provider,
          endpoint: settings.endpoint,
          model: settings.model,
        },
      });
      // 履歴に追加
      if (response.translated_text.trim()) {
        addToHistory(text, response.translated_text, settings.targetLang);
      }
    } catch (e) {
      setError(e as string);
    } finally {
      setIsLoading(false);
    }
  }, [sourceText, settings, addToHistory]);

  // ストリーミングチャンクを受信
  useEffect(() => {
    const unlisten = listen<string>("translation-chunk", (event) => {
      setTranslatedText((prev) => prev + event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 解説ストリーミングチャンクを受信
  useEffect(() => {
    const unlisten = listen<string>("explanation-chunk", (event) => {
      setExplanationText((prev) => prev + event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 翻訳キャンセルイベント
  useEffect(() => {
    const unlisten = listen("translation-cancelled", () => {
      setIsLoading(false);
      setIsCancelling(false);
      setError("翻訳がキャンセルされました");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 解説キャンセルイベント
  useEffect(() => {
    const unlisten = listen("explanation-cancelled", () => {
      setIsExplanationLoading(false);
      setIsExplanationCancelling(false);
      setExplanationError("解説がキャンセルされました");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleExplain = useCallback(async () => {
    if (
      explanationCacheRef.current &&
      explanationCacheRef.current.source === sourceText
    ) {
      setExplanationText(explanationCacheRef.current.explanation);
      return;
    }

    setIsExplanationLoading(true);
    setExplanationError(null);
    setExplanationText("");

    try {
      const response = await invoke<{ explanation: string }>("explain", {
        request: {
          source_text: sourceText,
          source_lang: "auto",
          target_lang: settings.targetLang,
          provider: settings.provider,
          endpoint: settings.endpoint,
          model: settings.model,
        },
      });
      explanationCacheRef.current = {
        source: sourceText,
        explanation: response.explanation,
      };
    } catch (e) {
      setExplanationError(e as string);
    } finally {
      setIsExplanationLoading(false);
    }
  }, [sourceText, settings]);

  const toggleExplanation = useCallback(() => {
    const willOpen = !isExplanationOpen;
    setIsExplanationOpen(willOpen);

    if (willOpen && !explanationText && sourceText) {
      handleExplain();
    }
  }, [isExplanationOpen, explanationText, sourceText, handleExplain]);

  const handleCancelTranslation = useCallback(async () => {
    setIsCancelling(true);
    try {
      await invoke("cancel_translation");
    } catch (e) {
      console.error("Failed to cancel translation:", e);
      setIsCancelling(false);
    }
  }, []);

  const handleCancelExplanation = useCallback(async () => {
    setIsExplanationCancelling(true);
    try {
      await invoke("cancel_explanation");
    } catch (e) {
      console.error("Failed to cancel explanation:", e);
      setIsExplanationCancelling(false);
    }
  }, []);

  // ホットキーからの選択テキスト受信と自動翻訳
  useEffect(() => {
    const unlisten = listen<string>("translate-selection", (event) => {
      const text = event.payload;
      if (text && text.trim()) {
        setSourceText(text);
        setShowSettings(false);
        pendingTranslateRef.current = true;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // sourceTextが更新されたら自動翻訳を実行
  useEffect(() => {
    if (pendingTranslateRef.current && sourceText.trim()) {
      pendingTranslateRef.current = false;
      handleTranslate(sourceText);
    }
  }, [sourceText, handleTranslate]);

  const handlePaste = async () => {
    try {
      const text = await invoke<string>("get_clipboard_text");
      setSourceText(text);
    } catch (e) {
      setError("クリップボードの読み取りに失敗しました");
    }
  };

  const handleCopy = async () => {
    try {
      await invoke("set_clipboard_text", { text: translatedText });
    } catch (e) {
      setError("クリップボードへのコピーに失敗しました");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleTranslate();
    }
  };

  const handleSelectHistory = (item: HistoryItem) => {
    setSourceText(item.sourceText);
    setTranslatedText(item.translatedText);
    setSettings((prev) => ({ ...prev, targetLang: item.targetLang }));
    setShowHistory(false);
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearHistory = () => {
    setHistory([]);
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "たった今";
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    if (diffDays < 7) return `${diffDays}日前`;
    return date.toLocaleDateString("ja-JP");
  };

  // Settings Page
  if (showSettings) {
    return (
      <div className="neu-settings">
        <div className="neu-settings-container">
          <header className="neu-settings-header">
            <h1 className="neu-settings-title">Settings</h1>
            <div className="neu-header-actions">
              <button
                onClick={toggleTheme}
                className="neu-theme-toggle"
                aria-label="Toggle theme"
              >
                {theme === "light" ? <MoonIcon /> : <SunIcon />}
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="neu-close-btn"
                aria-label="Close settings"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <div className="neu-card">
            <div className="neu-form-group">
              <label className="neu-form-label">AI Provider</label>
              <div className="neu-form-select-wrapper">
                <select
                  value={settings.provider}
                  onChange={(e) => {
                    const provider = e.target.value as "ollama" | "lmstudio";
                    setSettings({
                      ...settings,
                      provider,
                      endpoint: provider === "ollama" ? "http://localhost:11434" : "http://localhost:1234",
                    });
                  }}
                  className="neu-form-select"
                >
                  <option value="ollama">Ollama</option>
                  <option value="lmstudio">LM Studio</option>
                </select>
                <span className="neu-form-select-arrow"><ChevronIcon /></span>
              </div>
            </div>

            <div className="neu-form-group">
              <label className="neu-form-label">Endpoint</label>
              <input
                type="text"
                value={settings.endpoint}
                onChange={(e) => setSettings({ ...settings, endpoint: e.target.value })}
                className="neu-input"
              />
            </div>

            <div className="neu-form-group">
              <label className="neu-form-label">Model</label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                placeholder={settings.provider === "ollama" ? "llama3" : "local-model"}
                className="neu-input"
              />
            </div>

            <div className="neu-form-group">
              <label className="neu-form-label">Default Target Language</label>
              <div className="neu-form-select-wrapper">
                <select
                  value={settings.targetLang}
                  onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
                  className="neu-form-select"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <span className="neu-form-select-arrow"><ChevronIcon /></span>
              </div>
            </div>
          </div>

          <div className="neu-form-group">
              <label className="neu-form-label">Startup</label>
              <div
                className={`neu-toggle ${autostartEnabled ? "neu-toggle-active" : ""}`}
                onClick={toggleAutostart}
                role="switch"
                aria-checked={autostartEnabled}
                tabIndex={0}
              >
                <span className="neu-toggle-slider"></span>
                <span className="neu-toggle-label">
                  {autostartEnabled ? "PC起動時に自動起動する" : "自動起動しない"}
                </span>
              </div>
            </div>

          <div className="neu-hint">
            <p className="neu-hint-title">Hotkey</p>
            {isCapturingShortcut ? (
              <div className="neu-input neu-shortcut-capture">
                キーを入力してください...
              </div>
            ) : (
              <div
                className="neu-shortcut-display"
                onClick={() => setIsCapturingShortcut(true)}
                role="button"
                tabIndex={0}
              >
                <span className="neu-hint-text">
                  {formatShortcutDisplay(settings.shortcut)}
                </span>
                <span className="neu-shortcut-edit-hint">クリックで変更</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main Page
  return (
    <div className="neu-app">
      <div className="neu-container">
        {/* Header */}
        <header className="neu-header">
          <div className="neu-logo">
            <div className="neu-logo-icon">
              <TranslateIcon />
            </div>
            <span className="neu-logo-text">Translator</span>
          </div>
          <div className="neu-header-actions">
            <button
              onClick={toggleTheme}
              className="neu-theme-toggle"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="neu-history-btn"
              aria-label="History"
            >
              <HistoryIcon />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="neu-settings-btn"
              aria-label="Settings"
            >
              <SettingsIcon />
            </button>
          </div>
        </header>

        {/* Source Input Card */}
        <div className="neu-card">
          <div className="neu-card-header">
            <span className="neu-card-label">Input</span>
            <button onClick={handlePaste} className="neu-card-action">
              <PasteIcon />
              Paste
            </button>
          </div>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter text to translate..."
            className="neu-textarea"
          />
        </div>

        {/* Actions */}
        <div className="neu-actions">
          <div className="neu-select-wrapper">
            <select
              value={settings.targetLang}
              onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
              className="neu-select"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <span className="neu-select-arrow"><ChevronIcon /></span>
          </div>
          {isLoading ? (
            <button
              onClick={handleCancelTranslation}
              disabled={isCancelling}
              className="neu-btn-cancel"
            >
              {isCancelling ? (
                <span className="neu-loading">
                  <span className="neu-loading-dots">
                    <span className="neu-loading-dot"></span>
                    <span className="neu-loading-dot"></span>
                    <span className="neu-loading-dot"></span>
                  </span>
                  キャンセル中
                </span>
              ) : (
                <>
                  <CloseIcon />
                  キャンセル
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => handleTranslate()}
              disabled={!sourceText.trim()}
              className="neu-btn-primary"
            >
              <TranslateIcon />
              Translate
              <span className="neu-btn-shortcut">{isMac ? "⌘+Enter" : "Ctrl+Enter"}</span>
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="neu-error">
            <div className="neu-error-icon">
              <ErrorIcon />
            </div>
            {error}
          </div>
        )}

        {/* Result Card */}
        <div className="neu-card">
          <div className="neu-card-header">
            <span className="neu-card-label">Result</span>
            {translatedText && (
              <button onClick={handleCopy} className="neu-card-action">
                <CopyIcon />
                Copy
              </button>
            )}
          </div>
          <div className="neu-result">
            {translatedText || (
              <span className="neu-result-placeholder">
                Translation will appear here
              </span>
            )}
          </div>
        </div>

        {/* Explanation Card */}
        {translatedText && (
          <div className={`neu-explanation-card ${isExplanationOpen ? "neu-explanation-card-open" : ""}`}>
            <button
              className="neu-explanation-toggle"
              onClick={toggleExplanation}
              disabled={isLoading}
            >
              <BookOpenIcon />
              <span>原文の解説</span>
              <span className={`neu-explanation-chevron ${isExplanationOpen ? "neu-explanation-chevron-open" : ""}`}>
                <ChevronIcon />
              </span>
            </button>

            {isExplanationOpen && (
              <div className="neu-explanation-content">
                {isExplanationLoading && !explanationText && (
                  <div className="neu-explanation-loading">
                    <span className="neu-loading-dots">
                      <span className="neu-loading-dot"></span>
                      <span className="neu-loading-dot"></span>
                      <span className="neu-loading-dot"></span>
                    </span>
                    <span>解説を生成中...</span>
                    {!isExplanationCancelling && (
                      <button
                        onClick={handleCancelExplanation}
                        className="neu-cancel-small-btn"
                      >
                        <CloseIcon />
                        キャンセル
                      </button>
                    )}
                  </div>
                )}
                {explanationError && (
                  <div className="neu-explanation-error">
                    <ErrorIcon />
                    <span>{explanationError}</span>
                  </div>
                )}
                {explanationText && (
                  <div className="neu-explanation-text">
                    <Markdown>{filterEmptySections(explanationText)}</Markdown>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer Status */}
        <footer className="neu-footer">
          <div className="neu-status">
            <span className="neu-status-dot"></span>
            {settings.provider === "ollama" ? "Ollama" : "LM Studio"} · {settings.model} · {formatShortcutDisplay(settings.shortcut)}
          </div>
        </footer>
      </div>

      {/* History Sidebar */}
      <div className={`neu-sidebar-overlay ${showHistory ? "neu-sidebar-overlay-visible" : ""}`} onClick={() => setShowHistory(false)} />
      <aside className={`neu-sidebar ${showHistory ? "neu-sidebar-open" : ""}`}>
        <header className="neu-sidebar-header">
          <h2 className="neu-sidebar-title">History</h2>
          <div className="neu-header-actions">
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="neu-clear-btn"
                aria-label="Clear all history"
              >
                <TrashIcon />
              </button>
            )}
            <button
              onClick={() => setShowHistory(false)}
              className="neu-close-btn"
              aria-label="Close history"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="neu-sidebar-content">
          {history.length === 0 ? (
            <div className="neu-history-empty">
              <HistoryIcon />
              <p>翻訳履歴はありません</p>
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="neu-history-item"
                onClick={() => handleSelectHistory(item)}
              >
                <div className="neu-history-item-header">
                  <span className="neu-history-lang">
                    → {LANGUAGES.find((l) => l.code === item.targetLang)?.label || item.targetLang}
                  </span>
                  <span className="neu-history-time">{formatTimestamp(item.timestamp)}</span>
                </div>
                <div className="neu-history-source">{item.sourceText}</div>
                <div className="neu-history-result">{item.translatedText}</div>
                <button
                  className="neu-history-delete"
                  onClick={(e) => handleDeleteHistory(item.id, e)}
                  aria-label="Delete this history item"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

export default App;
