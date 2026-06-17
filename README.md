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

### 2. 環境変数の設定 (`.env`)

Contentful API にアクセスするための認証情報を設定します。

プロジェクトのルートディレクトリに `.env` ファイルを作成し、必要なAPI情報を記載してください。

#### 設定用ファイル作成
```bash
cp .env.example .env
```
*(※ すでに `.env` が作成されている場合は、直接そちらを編集してください)*

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
```

---

### 3. Contentful 環境のクリーンアップ

移行テストを複数回実行する場合など、Contentful 上のエントリーやアセットをすべて削除して初期状態にクリーンアップするためのスクリプトが用意されています。

> [!WARNING]
> このスクリプトは、設定されたスペースおよび環境内の**すべてのエントリーとアセットを削除**します。実行前に必ず `.env` の設定対象環境を確認してください。

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

---

## プロジェクト構成

- [wordpress/](./wordpress)
  - [content/](./wordpress/content) - WordPress の記事・固定ページなどのXMLエクスポートデータ（`WordPress.YYYY-MM-DD.xml` などの形式で配置）
  - [media/](./wordpress/media) - WordPress のメディアファイル（画像など）の展開先ディレクトリ
- [.env.example](./.env.example) - 環境変数のテンプレートファイル
- [.env](./.env) - ローカル環境変数設定ファイル（Git除外推奨）
- [README.md](./README.md) - 本ファイル
- [GEMINI.md](./GEMINI.md) - AIアシスタント向け開発コンテキスト

