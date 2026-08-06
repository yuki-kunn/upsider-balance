# upsider-balance

UPSIDERカード（法人カード）の残額をスタッフ全体で共有するアプリ。単一施設運用、施設ID/PASSでの共用ログインと、admin専用ページによる管理を提供する。

技術スタック: SvelteKit（フロントエンド + API、Vercelでホスティング） + Firestore / Storage / Authentication（Firebase）。詳細な要件・設計は [docs/design/](docs/design/) を参照。

## セットアップ

### 前提
- Node.js 20系（開発環境ではNode 22でも動作確認済み）
- pnpm（未インストールの場合: `corepack enable --install-directory ~/.local/bin && corepack prepare pnpm@latest --activate`。詳細は [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md)）
- Firebase CLI（`npm install -g firebase-tools` または `npx firebase-tools`）、`firebase login`済みであること（Firestore/Storageのルールデプロイ用）
- Vercel CLI（`npx vercel`）、`vercel login`済みであること（デプロイ用）

### 依存関係のインストール

```bash
pnpm install
```

### 環境変数の設定

`packages/web/.env.example` を `packages/web/.env` にコピーし、値を設定する。

```bash
cp packages/web/.env.example packages/web/.env
firebase apps:sdkconfig WEB <appId> --project upsider-balance
```

- `VITE_FIREBASE_*`: Firebase Web SDKのクライアント設定。クライアントに埋め込む前提の公開情報。
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Firebase Admin SDK用のサービスアカウント鍵（JSON文字列そのまま）。サーバー側のみで使用、機密情報。
- `GEMINI_API_KEY`: レシート画像解析用（Sprint4以降で使用）。
- `NOTION_TOKEN` / `NOTION_DATABASE_ID`: 購入登録のたびにレシート画像・金額・日付をNotionデータベースへ自動送信する連携機能で使用（任意。未設定でも購入登録自体は正常に動作し、Notion同期のみ `notSynced`/`failed` 扱いになる）。
  - Notion Integration（[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)）を作成し、Internal Integration Tokenを`NOTION_TOKEN`に設定する
  - 保存先データベースを作成し、Title・Number・Date・Files&mediaのプロパティを含める（プロパティ名は自由。型で自動検出される）。データベースの右上「…」→「コネクト」で上記Integrationを接続し、URLに含まれる32桁のIDを`NOTION_DATABASE_ID`に設定する
  - Notion送信が失敗した場合、admin管理画面の購入履歴に「Notion送信失敗」バッジと「Notionに再送信」ボタンが表示される

### アカウント作成（施設・admin）

施設ID/adminIDのアカウントはセルフサインアップ不可。以下のスクリプトで発行する（Firebase Admin SDKのサービスアカウント鍵が必要）。

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
pnpm create-account facility <facilityId> <password> [displayName]
pnpm create-account admin <adminId> <password>
```

施設アカウント作成時は `facilities/{facilityId}` ドキュメントと `facilities/{facilityId}/balance/current`（初期値0円）も同時に作成される。残額の初期設定・修正は admin ページから行う。

サービスアカウント鍵はリポジトリに含めず、ローカルの `~/.secrets/` 等gitignore対象外の場所に保管すること。

### 開発サーバー起動

```bash
pnpm run build          # shared -> web の順にビルド
pnpm run dev:web        # SvelteKit開発サーバー（API Routesも含めて動作、http://localhost:5173）
```

`packages/web/.env` に環境変数一式（`FIREBASE_SERVICE_ACCOUNT_KEY`含む）を設定していれば、`/api/**` へのリクエストもローカルでそのまま動作する。

Firestore/Authエミュレータの実体はJavaに依存する。Java未インストール環境ではエミュレータが起動できないため、その場合は実際のFirebaseプロジェクトに対してテスト用アカウントで検証する（詳細は [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md)）。

### Vercelへのデプロイ

```bash
cd packages/web
vercel link                                          # 初回のみ
vercel env add VITE_FIREBASE_API_KEY production --no-sensitive --value "<value>" --yes
# ...他のVITE_*も同様。FIREBASE_SERVICE_ACCOUNT_KEY / GEMINI_API_KEY はSensitiveのままでよい
vercel pull --yes --environment production
vercel build --prod
vercel deploy --prebuilt --prod
```

クライアントに公開される前提の`VITE_`変数は必ず`--no-sensitive`で登録すること（Sensitiveのままだとローカルビルドに実際の値が埋め込まれない、詳細はtroubleshootingログ参照）。

### Firestore/Storageルールのデプロイ

バックエンドはVercelでホスティングするが、Firestore/Storageのセキュリティルールは引き続きFirebase CLIでデプロイする。

```bash
firebase deploy --only firestore:rules,storage --project upsider-balance
```

## モノレポ構成

```
packages/
  web/        SvelteKit（adapter-vercel、SSR。src/lib/server/ にHono APIを内蔵し
              routes/api/[...path]/+server.ts 経由で実行）
  shared/     Firestore/APIの共有型定義
scripts/
  create-account.ts  施設/adminアカウント発行CLI
```

## ドキュメント

- [docs/design/](docs/design/) — 要件定義・アーキテクチャ・セキュリティ設計・コスト試算・スプリント計画
- [docs/rules/00_project_rules.md](docs/rules/00_project_rules.md) — プロジェクト共通ルール（技術スタック、確定仕様、ブランチ/PR運用）
- [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md) — 開発中に発生した問題と解決策の記録
- [docs/operations/00_operation_guide.md](docs/operations/00_operation_guide.md) — 施設スタッフ・admin向け運用ガイド（共用端末の扱い、パスワード運用、端末紛失時の緊急対応）

## 開発フロー

GitHub issueに沿ってスクラムスプリント形式で開発する。ブランチは `feat/`, `fix/`, `chore/`, `docs/` のプレフィックスを使い、1 issue = 1 PR を基本とする。詳細は `docs/rules/00_project_rules.md` のブランチ・PR運用ルールを参照。
