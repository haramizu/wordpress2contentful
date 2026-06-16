# Gemini Context: WordPress to Contentful Migration

このファイルは、AIアシスタント（Gemini / Antigravity）が本プロジェクトのコンテキストを迅速に把握し、開発をサポートするための設定・ドキュメントです。

## プロジェクト概要
WordPress のエクスポートデータ（XML・メディアアーカイブ）から Contentful への移行スクリプトを構築・実行するプロジェクトです。

## 移行元データ情報
- **XML データ:** `wordpress/content/` 配下に配置された WordPress のXMLエクスポートデータ（例: `WordPress.2026-06-16.xml` など）
- **メディアアーカイブ:** [media-export-197841949-from-0-to-1255.tar](./wordpress/media-export-197841949-from-0-to-1255.tar) (約1.6GB)
  - 解凍先: `wordpress/media/` ディレクトリ配下

## 設定・環境変数 (`.env.local`)
移行処理には Contentful にデータを書き込むための以下の環境変数が必要です。
ローカル開発時は [.env.local](./.env.local) に定義します。

- `CONTENTFUL_SPACE_ID`: 対象スペースID
- `CONTENTFUL_MANAGEMENT_TOKEN`: 管理用トークン（CMA / 必須）
- `CONTENTFUL_ACCESS_TOKEN`: 閲覧用トークン（CDA / オプション）
- `CONTENTFUL_PREVIEW_ACCESS_TOKEN`: プレビュー用トークン（CPA / オプション）
- `CONTENTFUL_ENVIRONMENT`: 環境名（通常は `master`）

## 開発・実行手順（予定）
今後、以下の処理を行うスクリプトを追加していく予定です：
1. **XML パース:** `wordpress/content/` 配下のXMLエクスポートデータから投稿、カテゴリー、タグ、メディア一覧の情報を抽出する。
2. **アセットアップロード:** 解凍したメディアファイルを Contentful Assets にアップロードし、公開する。
3. **エントリ作成:** 記事データを Contentful の該当コンテンツモデル（Blog Post 等）として登録し、アセットへのリンクを紐付ける。
