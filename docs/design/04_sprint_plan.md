# スクラムスプリント計画 — UPSIDER残額共有アプリ

## 1. 全体方針
設計フェーズ（要件定義・アーキテクチャ・セキュリティ・コスト試算）は完了。ここから実装フェーズに入る。1スプリント＝1機能ブロックの完成を目安とし、各スプリントの終わりに動作確認（`/verify`相当）とユーザーへの中間報告を行う。

## 2. エージェント体制

| エージェント | 役割 | 主な担当範囲 |
|---|---|---|
| Infra/Setup | プロジェクト基盤構築 | pnpm workspaces初期化、Firebase プロジェクト設定、firebase.json、Firestore/Storage rules、CI設定の土台 |
| Backend (Hono/Functions) | API実装 | Hono ルーティング、認証ミドルウェア、Firestoreトランザクション処理、Gemini API連携 |
| Frontend (SvelteKit) | 画面実装 | ログイン画面、スタッフダッシュボード（残額・購入登録・履歴）、adminページ |
| Security Reviewer | セキュリティレビュー | Firestore/Storage rulesの検証、認証フローのレビュー、`/code-review`や`/security-review`スキルの活用 |
| QA/Verify | 動作検証 | 各スプリント終了時に実機能能を検証、`verify`スキルの活用、バグ報告 |

各エージェントは作業前後で `docs/rules/00_project_rules.md` と `docs/troubleshooting/00_troubleshooting_log.md` を確認・更新する。私（オーケストレーター）が各エージェントの成果物をレビューし、整合性を取ってから次のスプリントに進める。

## 3. スプリント構成（案）

### Sprint 0: プロジェクト基盤構築
- pnpm workspacesモノレポ構成の作成（`packages/web`, `packages/functions`, `packages/shared`）
- Firebaseプロジェクトの作成（要ユーザー：GCP/Firebaseアカウントでのプロジェクト作成、または既存プロジェクトの指定）
- `firebase.json`, `.firebaserc`, Firestore/Storage rulesの初期配置
- 担当: Infra/Setup

### Sprint 1: 認証基盤
- Firebase Authentication セットアップ（施設ID/adminID→疑似メール変換ロジック）
- Custom Claims付与の仕組み（初期アカウント作成スクリプト）
- Honoの認証ミドルウェア（`verifyIdToken`, `requireRole`）
- フロントエンドのログイン画面（施設ログイン/adminログイン）
- 担当: Backend + Frontend + Security Reviewer

### Sprint 2: 残額表示・購入登録（コア機能）
- Firestoreデータモデル実装（`facilities/{id}/balance`, `purchases`）
- `GET /api/balance`, `POST /api/purchases`, `GET /api/purchases`
- スタッフダッシュボード（残額表示、購入登録フォーム、履歴一覧）
- 担当: Backend + Frontend

### Sprint 3: adminページ
- `PATCH /api/admin/balance`, `PATCH/DELETE /api/admin/purchases/:id`（削除時残額再加算含む）
- adminログイン後の管理画面（残額編集、履歴編集・削除）
- 担当: Backend + Frontend

### Sprint 4: レシート画像解析
- Storageアップロード（クライアント直）
- `POST /api/receipts/analyze`（Gemini 2.5 Flash連携、Secret Manager設定）
- フォームプリフィルUI
- 担当: Backend + Frontend

### Sprint 5: セキュリティ強化・仕上げ
- Firestore/Storage rulesの最終レビューと締め
- レート制限（ログイン試行制限、Gemini呼び出しソフトリミット）
- 全体的な動作検証、デプロイ
- 担当: Security Reviewer + QA/Verify

## 4. Sprint 0開始前に必要なユーザー側の準備
- Firebaseプロジェクトの用意（新規作成 or 既存プロジェクト指定）
- Google Cloud請求先アカウント（Blazeプラン化のため）の用意
- Gemini API利用のためのAPIキー取得（Google AI Studio）、またはこちらで取得方法を案内

## 5. 進め方
このスプリント計画に基づき、Sprint 0から順に着手する。各スプリント内のタスクは可能な範囲で並行実行するが、依存関係（例：Sprint 1の認証基盤がSprint 2以降の前提）があるため、完全な並列化はしない。
