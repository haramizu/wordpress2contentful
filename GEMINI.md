# Gemini Context: WordPress to Contentful Migration

このファイルは、AIアシスタント（Gemini / Antigravity）が本プロジェクトのコンテキストを迅速に把握し、開発をサポートするための設定・ドキュメントです。

## プロジェクト概要
WordPress のエクスポートデータ（XML・メディアアーカイブ）から Contentful への移行スクリプトを構築・実行するプロジェクトです。

## 移行元データ情報
- **XML データ:** `wordpress/content/` 配下に配置された WordPress のXMLエクスポートデータ（例: `WordPress.2026-06-16.xml` など）
- **メディアアーカイブ:** `wordpress/media/` は以下に配置された WordPress からエクスポートをしたメディアファイルの展開先ディレクトリです。メディアファイルが圧縮されている場合は `tar` コマンドで展開を行ってください。

## 設定・環境変数 (`.env`)
移行処理には Contentful にデータを書き込むための以下の環境変数が必要です。
ローカル開発時は [.env](./.env) に定義します。

- `CONTENTFUL_SPACE_ID`: 対象スペースID
- `CONTENTFUL_MANAGEMENT_TOKEN`: 管理用トークン（CMA / 必須）
- `CONTENTFUL_ACCESS_TOKEN`: 閲覧用トークン（CDA / オプション）
- `CONTENTFUL_PREVIEW_ACCESS_TOKEN`: プレビュー用トークン（CPA / オプション）
- `CONTENTFUL_ENVIRONMENT`: 環境名（通常は `master`）

## 開発・実行手順
以下の手順で移行処理を進めます：

1. **環境セットアップと最新XML検証 (完了):**
   `npm run setup` でコンテンツモデル（Category, Tag, Blog Post）を自動生成し、`wordpress/content/` 配下の最新のXMLファイルを検出します。
2. **アセットアップロード (完了):**
   `npm run media-upload` で `wordpress/media/` 内の全ローカルメディアファイルを Contentful Assets にアップロードし、公開します。各ファイルは決定論的 ID（Deterministic ID: `wp_media_<md5_hash_of_relative_path>`）で登録され、再実行時にはアップロード済みのファイルをスキップします。
3. **エントリ作成 (予定):**
   最新XMLファイルをパースし、記事データを Contentful の Blog Post などの該当モデルとしてエントリ登録します。その際、アップロード済みのアセットへの参照（カテゴリ、タグ、アイキャッチ/本文中画像）を紐付けます。
