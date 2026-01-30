# コードベース全体レビュー

## 概要

Tauri v2 + React 19 + TypeScript構成のローカルLLM翻訳デスクトップアプリ。Ollama / LM Studioに対応し、ストリーミング翻訳、グローバルホットキー、翻訳履歴、ダークモード等の機能を持つ。コードは比較的シンプルで機能的に動作するが、以下の改善点がある。

---

## 1. セキュリティ (重要度: 高)

### CSPが無効化されている

`src-tauri/tauri.conf.json:26` で `"csp": null` に設定されている。ローカルアプリであっても、Content Security Policyを適切に設定すべき。悪意のあるスクリプトインジェクションへの防御がない状態。

### HTTPリクエストにタイムアウトが未設定

`src-tauri/src/lib.rs:92` で `reqwest::Client::new()` をそのまま使用しており、タイムアウトが設定されていない。LLMサーバーが応答しない場合、アプリが無期限にハングする。

```rust
// 現状
let client = reqwest::Client::new();

// 推奨
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(120))
    .build()
    .map_err(|e| format!("Failed to create client: {}", e))?;
```

### Mutexの`unwrap()`

`src-tauri/src/lib.rs:350`, `lib.rs:362` — Mutex lockに`.unwrap()`を使用。パニックでロックが毒された場合、アプリがクラッシュする。

---

## 2. バグ・潜在的問題 (重要度: 高)

### PasteIconとCopyIconが同一のSVG

`src/App.tsx:81-93` — `PasteIcon`と`CopyIcon`が完全に同じSVGを描画している。`CopyIcon`はクリップボードからコピーするアイコンとして別のデザインにすべき。

### localStorageのJSON.parseが無防備

`src/App.tsx:161-162`, `App.tsx:170-171` — `JSON.parse(saved)` にtry-catchがない。localStorageが破損した場合、アプリの起動時にクラッシュする。

```typescript
// 現状
const saved = localStorage.getItem("translator-settings");
return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;

// 推奨
try {
  const saved = localStorage.getItem("translator-settings");
  return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
} catch {
  return DEFAULT_SETTINGS;
}
```

### ストリームのチャンク分割問題

`src-tauri/src/lib.rs:115-131` — バイトストリームのチャンクがJSONオブジェクトの途中で分割される可能性がある。`if let Ok(parsed)` で静かに失敗するが、その場合データが欠落する。バッファリング処理を入れるべき。

### エラーの型アサーション

`src/App.tsx:289` — `setError(e as string)` でTauri invokeのエラーをstringにキャストしている。エラーがobjectの場合、`[object Object]`が表示される。

---

## 3. パフォーマンス (重要度: 中)

### HTTPクライアントの再生成

`src-tauri/src/lib.rs:92` — 翻訳リクエストごとに`reqwest::Client::new()`で新しいクライアントを生成している。`reqwest::Client`は内部でコネクションプールを持つため、アプリの状態として1つ保持して再利用すべき。

### Google Fontsの外部CDN依存

`src/App.css:7` — `@import url('https://fonts.googleapis.com/...')` でフォントを外部CDNから読み込んでいる。ローカルLLMを使うオフライン志向のアプリにとって矛盾する。フォントをローカルにバンドルするか、システムフォントにフォールバックすべき。

---

## 4. コード品質 (重要度: 中)

### モノリシックコンポーネント

`src/App.tsx` — 709行の単一コンポーネント。以下の分離が自然：

- SVGアイコンコンポーネント群 → 別ファイル
- Settings画面 → 別コンポーネント
- HistorySidebar → 別コンポーネント
- カスタムhooks（useTranslation, useSettings等）

### 設定画面の遷移方式

`src/App.tsx:385` — `showSettings` のブール値で条件分岐し、メイン画面を完全に差し替えている。設定画面を開くとメイン画面のDOMが消滅し、アニメーションやスクロール位置が失われる。

### ハードコードされた色

`src/App.css:698` — `#68d391` がCSS変数を使わずに直接記述されている（トグルスイッチ、ステータスドット）。テーマの一貫性のためにCSS変数化すべき。

### LM Studioのプロンプト重複

`src-tauri/src/lib.rs:139` — systemメッセージとuserメッセージ（`build_translation_prompt`）の両方で「Only output the translated text」と指示しており、重複している。

---

## 5. 設定・構成の問題 (重要度: 低)

### index.htmlのタイトル

`index.html:6` — `<title>Tauri + React + Typescript</title>` がデフォルトのまま。「Translator」に変更すべき。

### ファビコン

`index.html:5` — `href="/vite.svg"` がViteデフォルトのまま。アプリ専用のアイコンに差し替えるべき。

### ビルドターゲット

`src-tauri/tauri.conf.json:30` — `"targets": "all"` で全プラットフォームを対象にしているが、ホットキー実装がWindows専用（PowerShell経由）のため、実質Windows限定。

### リンター・フォーマッター未導入

ESLint、Prettier等が未設定。TypeScriptの`strict`モードは有効だが、コードスタイルの一貫性を保つためにリンターの導入が望ましい。

---

## 6. 良い点

- **ストリーミング対応**: OllamaとLM Studio両方でストリーミングレスポンスに対応し、ユーザー体験が良い
- **ニューモーフィックデザイン**: CSS変数による一貫したデザインシステムとダークモード対応
- **グローバルショートカット**: カスタマイズ可能なホットキーによるシームレスな翻訳ワークフロー
- **TypeScript strictモード**: 型安全性の確保
- **シングルインスタンス制御**: 多重起動防止の実装
- **Tauri capabilities**: 最小権限の原則に沿った権限設定

---

## 優先対応推奨

| 優先度 | 項目 | ファイル |
|--------|------|----------|
| **高** | HTTPタイムアウト追加 | `src-tauri/src/lib.rs` |
| **高** | localStorage JSON.parseのtry-catch | `src/App.tsx` |
| **高** | CSPの適切な設定 | `src-tauri/tauri.conf.json` |
| **中** | reqwest::Clientの再利用 | `src-tauri/src/lib.rs` |
| **中** | ストリームチャンクのバッファリング | `src-tauri/src/lib.rs` |
| **中** | CopyIconのSVG修正 | `src/App.tsx` |
| **低** | index.htmlのタイトル修正 | `index.html` |
| **低** | Google Fontsのローカル化 | `src/App.css` |
