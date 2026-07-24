# upsider-balance

UPSIDERカード（法人カード）の残額をスタッフ全体で共有するアプリ。単一施設運用、施設ID/PASSでの共用ログインと、admin専用ページによる管理を提供する。

技術スタック: SvelteKit（フロントエンド） + Hono on Cloud Functions for Firebase（バックエンド） + Firestore / Storage / Authentication（Firebase）。詳細な要件・設計は [docs/design/](docs/design/) を参照。

## セットアップ

### 前提
- Node.js 20系（開発環境ではNode 22でも動作確認済み、Cloud Functions実行ランタイムは20指定）
- pnpm（未インストールの場合: `corepack enable --install-directory ~/.local/bin && corepack prepare pnpm@latest --activate`。詳細は [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md)）
- Firebase CLI（`npm install -g firebase-tools` または `npx firebase-tools`）、`firebase login`済みであること

### 依存関係のインストール

```bash
pnpm install
```

### Firebase Web SDK設定

`packages/web/.env.example` を `packages/web/.env` にコピーし、Firebase ConsoleまたはFirebase CLIから取得した値を設定する。

```bash
cp packages/web/.env.example packages/web/.env
firebase apps:sdkconfig WEB <appId> --project upsider-balance
```

Web APIキーはクライアントに埋め込む前提の公開情報であり、サービスアカウント鍵とは機密度が異なる。

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
pnpm run build          # shared -> web -> functions の順にビルド
pnpm run dev:web        # SvelteKit開発サーバー
pnpm run emulators      # Firebase Local Emulator Suite（Auth/Firestore/Functions/Storage）
```

Firestore/Authエミュレータの実体はJavaに依存する。Java未インストール環境ではエミュレータが起動できないため、その場合は実際のFirebaseプロジェクトに対してテスト用アカウントで検証する（詳細は [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md)）。

## モノレポ構成

```
packages/
  web/        SvelteKit（adapter-static, SPA）
  functions/  Hono + Cloud Functions for Firebase
  shared/     Firestore/APIの共有型定義
scripts/
  create-account.ts  施設/adminアカウント発行CLI
```

## ドキュメント

- [docs/design/](docs/design/) — 要件定義・アーキテクチャ・セキュリティ設計・コスト試算・スプリント計画
- [docs/rules/00_project_rules.md](docs/rules/00_project_rules.md) — プロジェクト共通ルール（技術スタック、確定仕様、ブランチ/PR運用）
- [docs/troubleshooting/00_troubleshooting_log.md](docs/troubleshooting/00_troubleshooting_log.md) — 開発中に発生した問題と解決策の記録

## 開発フロー

GitHub issueに沿ってスクラムスプリント形式で開発する。ブランチは `feat/`, `fix/`, `chore/`, `docs/` のプレフィックスを使い、1 issue = 1 PR を基本とする。詳細は `docs/rules/00_project_rules.md` のブランチ・PR運用ルールを参照。
