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
- `CONTENTFUL_LOCALE`: デフォルトロケール名（通常は `ja-JP`）

## 開発・実行手順
以下の手順で移行処理を進めます：

1. **環境セットアップと最新XML検証 (完了):**
   `npm run setup` でコンテンツモデル（Category, Tag, Blog Post）を自動生成し、`wordpress/content/` 配下の最新のXMLファイルを検出します。
2. **アセットアップロード (完了):**
   `npm run media-upload` で `wordpress/media/` 内の全ローカルメディアファイルを Contentful Assets にアップロードし、公開します。
   - **決定論的 ID:** 各アセットは、相対パスに基づいた一意なID（`wp_media_<md5_hash_of_relative_path>`）で登録され、再実行時には既にアップロード済みのファイルをスキップします。
   - **メタデータ自動抽出:** XMLファイル内のアタッチメント情報から `title` と `description` を抽出し、Contentfulのアセット情報に設定します。
   - **本文からの代替テキスト（alt）スクレイピング:** アタッチメント自体に説明文が存在しない画像に関しては、記事本文（`<content:encoded>`）中の `<img>` タグの `alt` 属性を自動的にスクレイピングしてアセットの `description` に補完します。
3. **エントリ作成 (完了):**
   `npm run content-upload` で最新XMLファイルをパースし、記事データ（Category, Tag, Blog Post）のエントリーを Contentful に登録・公開します。
   - **決定論的 ID:** 各エントリーは、元の WordPress ID に基づいた一意なID（例: `wp_post_<wordpressId>`）で登録され、再実行時には安全に更新（上書き）されます。
   - **リレーション自動紐付け:** カテゴリ、タグ、および featuredImage（アイキャッチ画像等）の参照リンク（References）を自動的に解決し紐付けます。
   - **ステータス自動同期:** 元の WordPress 上で `publish` ステータスの記事のみ、登録後に自動で公開（Publish）されます。
