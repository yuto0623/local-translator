# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ローカルLLMサーバー（Ollama / LM Studio）を利用したデスクトップ翻訳アプリ。Tauri v2（Rust）+ React 19 + TypeScript + Vite構成。

- **バージョン**: 1.1.0（package.json / Cargo.toml / tauri.conf.json で管理）
- **識別子**: `com.translator.app`
- **対応言語**: 日本語, English, 中文, 한국어, Français, Deutsch, Español（7言語）

## 開発コマンド

```bash
npm run dev          # Viteフロントエンド開発サーバー起動（port 1420）
npm run build        # TypeScriptコンパイル + Viteビルド
npm run tauri dev    # Tauriアプリとして開発起動（フロントエンド+Rustバックエンド同時起動）
npm run tauri build  # プロダクションビルド（beforeBuildCommandでnpm run buildが自動実行される）

node scripts/generate-icons.mjs  # SVGからアイコン一括生成（PNG + ICO）
```

リンター・フォーマッター・テストフレームワークは未導入。

## CI/CD

GitHub Actionsでリリース自動化（`.github/workflows/release.yml`）。
- **トリガー**: `v*` タグのpush（例: `v1.0.1`）
- **ビルド対象**: Windows（`windows-latest`）+ macOS（`macos-latest`、Universal Binary）
- **成果物**: Windows → `.msi` / `.exe`、macOS → `.dmg`（Intel + Apple Silicon対応）をGitHub Releaseに自動アップロード
- **手順**: Node.js v20 + Rust stable → `npm ci` → `tauri-apps/tauri-action`
- **macOS**: `--target universal-apple-darwin` で両アーキテクチャ対応。未署名のため初回起動時は右クリック→「開く」が必要

## アイコン

アプリアイコンは `src-tauri/icons/icon.svg` をソースとして管理。SVGを編集後、`node scripts/generate-icons.mjs` で全サイズのPNG/ICOを自動生成。

## アーキテクチャ

### フロントエンド (`src/`)
- `App.tsx` に全UIが単一コンポーネントとして実装されている（モノリシック構成）
- 状態管理はReact hooks（useState/useRef）、設定の永続化はlocalStorage
- `App.css` にニューモーフィックデザインシステムが実装されている（Tailwind CSS v4も併用）
- フォント: Outfit（UI）+ JetBrains Mono（等幅）— Google Fontsから読み込み
- ダークモード対応済み（`data-theme`属性で切替、localStorageに永続化）
- 翻訳履歴機能: 最大50件保持、相対時刻表示、個別削除・一括クリア対応
- 原文の解説機能: 翻訳結果下部に「原文の解説」ボタンを配置。クリックすると原文の単語・スラング・文脈を解説（ストリーミング対応、`explanation-chunk`イベント）
- localStorageキー: `translator-settings`, `translator-theme`, `translator-history`
- UIページ: メイン（翻訳）/ 設定 / 履歴サイドバー
- インラインSVGアイコン（Settings, Close, Paste, Copy, Translate, Chevron, Error, Sun, Moon, History, Trash）

### Rustバックエンド (`src-tauri/src/`)
- `lib.rs` に主要ロジックが集約。Tauriコマンドとしてフロントエンドに公開:
  - `translate` — Ollama (`/api/generate`) または LM Studio (`/v1/chat/completions`) へHTTPリクエスト
  - `explain` — 原文の単語・スラング・文脈を解説（ストリーミング対応）
  - `cancel_translation` — ストリーミング中の翻訳をキャンセル（リクエストID指定）
  - `get_clipboard_text` / `set_clipboard_text` — クリップボード操作
  - `update_shortcut` — グローバルショートカットの動的変更
  - `get_autostart_enabled` / `set_autostart_enabled` — PC起動時の自動起動設定
- `main.rs` はTauriアプリのエントリポイント
- HTTPクライアント: reqwest（タイムアウト120秒、ストリーミング対応）
- 非同期ランタイム: tokio（fullフィーチャー）、futures-util（ストリーム処理）

### システム統合機能（Rustバックエンド側）
- **グローバルショートカット**: カスタマイズ可能（デフォルト: Ctrl+Alt+L）→ PowerShellでCtrl+Cシミュレーション → 100ms待機 → クリップボード読取 → `translate-selection`イベント発行 → フロントエンドが自動翻訳
- **システムトレイ**: 左クリックでウィンドウ表示切替、右クリックメニュー（表示/非表示/終了）
- **自動起動**: PC起動時にアプリを自動起動するオプション（Settings画面で設定）
- **シングルインスタンス**: 多重起動防止、2つ目の起動時は既存ウィンドウを表示

### 翻訳ストリーミング
- **Ollama**: `/api/generate` — JSON行ストリーム形式（`bytes_stream()`で1行ずつパース）
- **LM Studio**: `/v1/chat/completions` — SSE（Server-Sent Events）形式、`data: ` プレフィックスと `[DONE]` マーカー対応
- LM Studioはtemperature: 0.3、systemメッセージ付きのOpenAI互換リクエスト
- 各チャンクは `translation-chunk` イベントでフロントエンドにリアルタイム送信

### キャンセル機能（翻訳のみ）
- `CancellationFlags`構造体で`AtomicU64`によるリクエストID管理（スレッドセーフ）
- フロントエンドは翻訳ごとにインクリメントするリクエストIDを発行し、キャンセル時にIDを指定することで競合状態を防止
- キャンセルイベント: `translation-cancelled`（ペイロードにリクエストIDを含む）
- キャンセル結果はエラーではなく情報メッセージ（`neu-info`）として表示
- Escキーでローディング中の翻訳をキャンセル可能
- フロントエンド側に3秒のタイムアウトフォールバックあり（イベント未到達時の安全策）

### デフォルト設定
```json
{
  "provider": "ollama",
  "endpoint": "http://localhost:11434",
  "model": "llama3",
  "targetLang": "Japanese",
  "shortcut": "Ctrl+Alt+L"
}
```

### キーボードショートカット
- **翻訳実行**: Ctrl+Enter / Cmd+Enter（フロントエンド）
- **キャンセル**: Escape（翻訳のストリーミング中）
- **グローバルホットキー**: カスタマイズ可能（修飾キー: Ctrl/Shift/Alt/Super、キー: A-Z, 0-9, F1-F12, Space, Enter, 矢印キー等）

### データフロー
```
ユーザー入力 or グローバルホットキー
  → React state更新
  → Tauri invoke() でRustバックエンドを呼出
  → reqwest HTTPクライアントでローカルLLMサーバーへリクエスト
  → レスポンスをフロントエンドに返却
  → UI再レンダリング
```

## 使用プラグイン

Tauri v2のプラグインシステムを使用。権限設定は `src-tauri/capabilities/default.json` で管理。

| プラグイン | 用途 |
|-----------|------|
| `tauri-plugin-clipboard-manager` | クリップボード読み書き |
| `tauri-plugin-global-shortcut` | グローバルホットキー登録 |
| `tauri-plugin-opener` | 外部リンク・ファイルを開く |
| `tauri-plugin-autostart` | PC起動時の自動起動 |
| `tauri-plugin-single-instance` | 多重起動防止 |

## ウィンドウ・CSP設定

- **ウィンドウサイズ**: 920×550（リサイズ可、中央配置）
- **CSP**: `connect-src`で`http://localhost:*`と`http://127.0.0.1:*`を許可（ローカルLLMサーバー接続用）
- **フォント**: Google Fonts（`fonts.googleapis.com` / `fonts.gstatic.com`）を`style-src`/`font-src`で許可

## Vite開発サーバー

- ポート: 1420（strictPort）、HMR: wsプロトコル ポート1421
- `src-tauri/` はファイル監視から除外（`server.watch.ignored`）
- `clearScreen: false`（Rustのエラーメッセージを保持）

## プラットフォーム対応

### Windows
- **動作環境**: Windows 10/11
- **グローバルホットキー**: PowerShell経由でCtrl+Cをシミュレーション（クリップボード連携）
- **ビルド成果物**: `.msi` / `.exe`

### macOS
- **動作環境**: macOS 12+
- **アーキテクチャ**: Universal Binary（Intel + Apple Silicon対応）
- **制約**: 未署名のため初回起動時は右クリック→「開く」で起動が必要
- **グローバルホットキー**: AppleScript経由でCmd+Cをシミュレーション（クリップボード連携）
- **ビルド成果物**: `.dmg`

## ランディングページ

`docs/` にGitHub Pages対応のランディングページが含まれている。
- **ファイル**: `docs/index.html`
- **サムネイル**: `docs/thumbnail.png`（READMEで使用）
- **機能**: GitHub Releasesへの直接ダウンロードリンク、ニューモーフィックデザイン
- **配信**: `.nojekyll` ファイルにより静的サイトとして配信可能

## 注意事項

- AI providerの切替はフロントエンドのUI設定から行い、バックエンドは受け取ったprovider名に応じてAPIエンドポイントとリクエスト形式を切り替える
- グローバルホットキーのクリップボード連携はプラットフォーム別実装（Windows: PowerShell経由、macOS: AppleScript経由）
- ウィンドウの閉じるボタンはアプリを終了せずトレイに格納（`on_window_event`でCloseRequestedをインターセプト）
- トレイアイコンは`lib.rs`の`setup`関数内で`TrayIconBuilder`により作成（`tauri.conf.json`での設定は削除済み）
- トレイメニューのラベルは日本語（「表示」「隠す」「終了」）
- ショートカットの状態管理は`CurrentShortcut`構造体（Mutex）でスレッドセーフに管理
- バージョン番号の変更は3箇所同時に更新が必要: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- TypeScript strict modeが有効（`noUnusedLocals`, `noUnusedParameters`含む）
