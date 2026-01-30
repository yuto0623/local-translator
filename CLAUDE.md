# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ローカルLLMサーバー（Ollama / LM Studio）を利用したデスクトップ翻訳アプリ。Tauri v2（Rust）+ React 19 + TypeScript + Vite構成。

## 開発コマンド

```bash
npm run dev          # Viteフロントエンド開発サーバー起動（port 1420）
npm run build        # TypeScriptコンパイル + Viteビルド
npm run tauri dev    # Tauriアプリとして開発起動（フロントエンド+Rustバックエンド同時起動）
npm run tauri build  # プロダクションビルド（beforeBuildCommandでnpm run buildが自動実行される）
```

リンター・フォーマッター・テストフレームワークは未導入。

## アーキテクチャ

### フロントエンド (`src/`)
- `App.tsx` に全UIが単一コンポーネントとして実装されている（モノリシック構成）
- 状態管理はReact hooks（useState/useRef）、設定の永続化はlocalStorage
- `App.css` にニューモーフィックデザインシステムが実装されている（Tailwind CSSも併用）
- ダークモード対応済み（`data-theme`属性で切替）

### Rustバックエンド (`src-tauri/src/`)
- `lib.rs` に主要ロジックが集約。Tauriコマンドとしてフロントエンドに公開:
  - `translate` — Ollama (`/api/generate`) または LM Studio (`/v1/chat/completions`) へHTTPリクエスト
  - `get_clipboard_text` / `set_clipboard_text` — クリップボード操作
  - `update_shortcut` — グローバルショートカットの動的変更
  - `get_autostart_enabled` / `set_autostart_enabled` — PC起動時の自動起動設定
- `main.rs` はTauriアプリのエントリポイント

### システム統合機能（Rustバックエンド側）
- **グローバルショートカット**: カスタマイズ可能（デフォルト: Ctrl+Alt+L）→ PowerShellでCtrl+Cシミュレーション → 100ms待機 → クリップボード読取 → `translate-selection`イベント発行 → フロントエンドが自動翻訳
- **システムトレイ**: 左クリックでウィンドウ表示切替、右クリックメニュー（表示/非表示/終了）
- **自動起動**: PC起動時にアプリを自動起動するオプション（Settings画面で設定）
- **シングルインスタンス**: 多重起動防止、2つ目の起動時は既存ウィンドウを表示

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

## 注意事項

- AI providerの切替はフロントエンドのUI設定から行い、バックエンドは受け取ったprovider名に応じてAPIエンドポイントとリクエスト形式を切り替える
- グローバルホットキーのクリップボード連携はWindows固有の実装（PowerShell経由）
- ウィンドウの閉じるボタンはアプリを終了せずトレイに格納（`on_window_event`でCloseRequestedをインターセプト）
- トレイアイコンは`lib.rs`の`setup`関数内で`TrayIconBuilder`により作成（`tauri.conf.json`での設定は削除済み）
