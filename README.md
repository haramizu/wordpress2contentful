# WordPress to Contentful Migration Project

このプロジェクトは、WordPress のデータ（記事、メディアなど）を Contentful へ移行するためのツール・スクリプト群です。

## 移行準備手順

移行作業を進める前に、以下の準備手順を完了させてください。

### 1. メディアエクスポートファイルの解凍

WordPress からエクスポートしたメディアファイル（画像など）のアーカイブが `wordpress/` ディレクトリ配下に格納されています。
移行処理の前に、以下の手順で解凍を行ってください。

#### 解凍コマンド
プロジェクトのルートディレクトリで以下のコマンドを実行します。

```bash
# 解凍先ディレクトリを作成
mkdir -p wordpress/media/

# 解凍・展開を実行
tar -xvf wordpress/media-export-197841949-from-0-to-1255.tar -C wordpress/media/
```

- **注意点:** 
  - アーカイブファイルのサイズが非常に大きいため（約1.6GB）、展開には数分かかる場合があります。
  - ディスクの空き容量に十分な余裕（数GB以上）があることを事前に確認してください。

---

### 2. 環境変数の設定 (`.env` / `.env.local`)

Contentful API にアクセスするための認証情報を設定します。

プロジェクトのルートディレクトリに `.env` または `.env.local` ファイルを作成し、必要なAPI情報を記載してください。本スクリプトは、安全のために `.env` より優先して `.env.local` から環境変数を読み込みます。

#### 設定用ファイル作成
```bash
cp .env.example .env
```
*(※ ローカル専用キーとして `.env.local` を作成し編集することも推奨します)*

#### `.env` の設定項目

```env
# Contentful のスペースID
CONTENTFUL_SPACE_ID=YOUR_SPACE_ID

# Contentful Content Management API (CMA) アクセストークン
# WordPress からのデータを Contentful に書き込むために必須のトークンです。
# 個人設定 (Personal settings) -> Access Tokens から生成可能です。
CONTENTFUL_MANAGEMENT_TOKEN=YOUR_MANAGEMENT_TOKEN

# Contentful Content Delivery API (CDA) アクセストークン (オプション)
# 公開済みコンテンツの読み込みに使用します。
CONTENTFUL_ACCESS_TOKEN=YOUR_ACCESS_TOKEN

# Contentful Content Preview API (CPA) アクセストークン (オプション)
# 下書き段階のコンテンツの読み込みに使用します。
CONTENTFUL_PREVIEW_ACCESS_TOKEN=YOUR_PREVIEW_ACCESS_TOKEN

# 移行先の環境ID (デフォルト: master)
# 通常は sandbox 環境や master 環境を指定します。
CONTENTFUL_ENVIRONMENT=master

# 移行先デフォルトロケール（デフォルト: ja-JP）
# お使いの Contentful スペースのロケールに合わせて指定してください（例: ja-JP, en-US など）。
CONTENTFUL_LOCALE=ja-JP
```

---

### 3. Contentful 環境のクリーンアップ

移行テストを複数回実行する場合など、Contentful 上のエントリーやアセットをすべて削除して初期状態にクリーンアップするためのスクリプトが用意されています。

> [!WARNING]
> このスクリプトは、設定されたスペースおよび環境内の**すべてのエントリー、アセット、および作成されたコンテンツモデルを削除**します。実行前に必ず `.env` の設定対象環境を確認してください。

#### クリーンアップの実行手順

1. 依存関係のインストール（初回のみ）
   ```bash
   npm install
   ```

2. 安全確認のためのドライラン（確認のみ）
   ```bash
   npm run cleanup
   ```
   ターゲットのスペースIDと環境IDが表示され、実行には `-- --confirm` フラグが必要な旨が表示されます。

3. 実際の削除の実行
   ```bash
   npm run cleanup -- --confirm
   ```

   - **アセット（メディアファイル）を削除せずに残したい場合:**
     ```bash
     npm run cleanup -- --confirm --keep-media
     ```

---

### 4. Contentful 環境のセットアップ（Content Type作成）

移行に必要なコンテンツモデル（Category, Tag, Blog Post）を Contentful 側に自動で作成・設定します。また、`wordpress/content/` 配下の最新のXMLファイルを検出して確認します。

#### セットアップの実行
```bash
npm run setup
```

---

### 5. メディアファイルのアップロード

`wordpress/media/` 配下に解凍したメディアファイルを Contentful Asset として一括アップロードおよび公開（Publish）します。

- 処理はレートリミットを考慮して安全に行われ、各ファイルは相対パスを基に一意な決定論的 ID（Deterministic ID）で登録されるため、再実行時はすでにアップロード・公開済みのファイルをスキップします。

#### メディアアップロードの実行
```bash
npm run media-upload
```

---

### 6. エントリーデータ（記事・カテゴリ・タグ）のアップロード

パースしたXMLからカテゴリ、タグ、記事データ（Blog Post）を読み込み、Contentful の該当コンテンツモデルへ移行・登録します。

- すべてのカテゴリ・タグが自動的に作成および公開（Publish）されます。
- 記事の移行時、対応するカテゴリ、タグ、および featuredImage（アイキャッチ画像など）の参照リンク（References）が自動的に紐付きます。
- 移行されたエントリーは決定論的 ID（例: `wp_post_<wordpressId>`）を持つため、再実行時は安全に更新（上書き）され、二重登録は発生しません。
- 元の WordPress のステータスが `publish` の記事のみ、アップロード後に自動公開（Publish）されます。

#### コンテンツアップロードの実行
```bash
npm run content-upload
```

---

## 移行処理の仕様と機能特徴

本移行スクリプト群は、本番運用時にも安全に再実行（べき等性の担保）できるよう設計されています。

### 1. 決定論的 ID (Deterministic ID) 生成規則
二重登録やデータの重複を防ぐため、WordPress 側の識別子に基づき Contentful の ID を一意に生成（MD5ハッシュ化またはID埋め込み）して移行します。

| 移行対象 | Contentful ID 生成規則 | 説明 |
| :--- | :--- | :--- |
| **Asset (メディア)** | `wp_media_<md5_hash_of_relative_path>` | `wordpress/media/` 内の相対パスを基に生成 |
| **Category** | `wp_cat_<md5_hash_of_slug>` | カテゴリのスラッグ（slug）の MD5 ハッシュ値 |
| **Tag** | `wp_tag_<md5_hash_of_slug>` | タグのスラッグ（slug）の MD5 ハッシュ値 |
| **Blog Post** | `wp_post_<wordpressId>` | WordPress 上での投稿ID（`wp:post_id`） |

これにより、途中でアップロードが失敗した場合や、WordPress 側で内容が更新されて再実行した場合にも、既存の同じ ID のエントリーを安全に上書き・更新（Update）します。

### 2. HTML から Contentful Rich Text への自動変換
WordPress の本文（`<content:encoded>` 内の HTML）は、Contentful の `RichText` フィールドに対応する AST（抽象構文木）形式へ自動変換されます。
- **対応要素:** 太字 (`strong`, `b`), 斜体 (`em`, `i`), 下線 (`u`), コードブロック (`code`), 改行 (`br`), リンク (`a`), 見出し (`h1`〜`h6`), リスト (`ul`, `ol`), 引用 (`blockquote`)。
- **インライン画像の自動埋め込み化:** 本文中の `<img>` タグの `src` 属性から画像パスを抽出し、該当する Contentful アセットの決定論的 ID（`wp_media_...`）へと自動で解決し、本文中の `embedded-asset-block` (インライン埋め込みアセットブロック) として再構築します。
- **サイト内リンクの相対パス化:** 本文中の `<a>` タグの `href` 属性に `siteUrl` (`https://haramizujp.wordpress.com`) が含まれている場合、ドメイン情報を削除して相対パス（`/` から始まる形）に自動変換します。


### 3. メディアメタデータの抽出と alt 属性スクレイピング
`media-upload.js` では、以下の順序でメディアのタイトルと説明（Description）を設定します。
1. **XML アタッチメント情報の抽出:** 最新XML内のアタッチメント情報から `title` と `description` (または `excerpt:encoded`)、および画像代替テキスト (`_wp_attachment_image_alt` ポストメタキー) を抽出します。
2. **本文からの alt スクレイピング (フォールバック):** アタッチメント自体に説明文や代替テキストがない画像は、記事本文（`<content:encoded>`）中の `<img>` タグを走査し、同一画像名に設定されている `alt` 属性値を自動取得してアセットの `description` に補完します。

### 4. API レートリミット対策と同時実行制御
Contentful API のレートリミット（Rate Limits）による制限・エラーを回避するため、以下の対策を行っています。
- `asyncPool` による同時実行数の制御（標準で並行数 `2`）。
- 処理リクエスト間に一定のウェイト（`sleep(350)` など）を設けることで、API制限の発生を防ぎ安定してインポートを進めます。

---

## プロジェクト構成

- [wordpress/](./wordpress)
  - [content/](./wordpress/content) - WordPress の記事・固定ページなどのXMLエクスポートデータ（`WordPress.YYYY-MM-DD.xml` などの形式で配置）
  - [media/](./wordpress/media) - WordPress のメディアファイル（画像など）の展開先ディレクトリ
- [scripts/](./scripts)
  - [cleanup.js](./scripts/cleanup.js) - Contentful環境の全エントリー、アセット、コンテンツモデルを一括削除して初期化するクリーンアップスクリプト
  - [setup.js](./scripts/setup.js) - 移行に必要なコンテンツモデル（Category, Tag, Blog Post）の作成・更新および、最新のXMLファイルの検証を行うセットアップスクリプト
  - [media-upload.js](./scripts/media-upload.js) - ローカルメディアのアップロードと、XMLからのタイトル・代替テキスト（alt）自動抽出・反映を行うアセットアップロードスクリプト
  - [content-upload.js](./scripts/content-upload.js) - XMLデータをパースし、カテゴリ、タグ、記事エントリー（参照リンク紐付け、アイキャッチ紐付けを含む）をContentfulへアップロードするスクリプト
- [.env.example](./.env.example) - 環境変数のテンプレートファイル
- [.env](./.env) - ローカル環境変数設定ファイル（Git除外推奨）
- [README.md](./README.md) - 本ファイル
- [GEMINI.md](./GEMINI.md) - AIアシスタント向け開発コンテキスト


