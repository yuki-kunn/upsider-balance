# プロジェクトルール — UPSIDER残額共有アプリ

このファイルは全エージェント（Frontend/Backend/Infra/QA等）が開発中に遵守するルールを記録する。セッションがリセットされても、このファイルを読めば経緯とルールが分かるようにする。

## 決定事項の記録方法
- 仕様や設計に関する決定は `docs/design/` 配下の該当文書に追記する（このファイルには書かない）。
- 実装中に発覚した技術的な制約・回避策・ハマりどころは `docs/troubleshooting/` に追記する。
- 「今後全エージェントが従うべきルール」（コーディング規約、命名規則、ライブラリ選定の理由等）はこのファイルに追記する。

## 技術スタック（確定）
- フロントエンド: SvelteKit（`adapter-static`によるSPA構成）
- バックエンド: Hono（Cloud Functions for Firebase、単一エントリポイント）
- DB: Firestore
- 認証: Firebase Authentication（施設ID/adminIDを疑似メールに変換、Custom Claimsでロール管理）
- ストレージ: Firebase Storage（レシート画像）
- 画像解析: Gemini 2.5 Flash（AI Studio APIキー方式、サーバー側=Hono経由のみで呼び出す）
- ホスティング: Firebase Hosting（無料サブドメイン、独自ドメインなし）
- モノレポ構成: pnpm workspaces（`packages/web`, `packages/functions`, `packages/shared`）

## 確定した仕様上の重要ルール
1. スタッフ個人は識別・記録しない（誰が購入したかは保存しない）。
2. 施設ログインとadminログインは完全に別のID/PASS体系（別のFirebase Authユーザー、別のCustom Claims `role`）。
3. 残額・購入履歴へのFirestore直接書き込みはクライアントから禁止。すべてHono API（Cloud Functions, Admin SDK）経由のトランザクションで行う。
4. 購入履歴の編集・削除はadminのみ可能。削除時は残額に金額を再加算する。
5. 施設・adminともに長期セッション（Firebase Auth SDK標準の永続化に任せる）。
6. 監査ログは実装しない（初回リリースのスコープ外）。
7. 設定画面はスタッフには提供しない。管理系操作はすべてadminページに集約。
8. Gemini APIキーはクライアントに一切渡さない。Secret Manager経由でHono（サーバー）のみが保持する。

## コーディング規約（実装フェーズで随時追記）
- （実装開始後、各エージェントがここに追記していく）

## ローカル開発・認証情報の取り扱い
- Firebase Admin SDKのサービスアカウント鍵は `/home/yuki/.secrets/upsider-balance-adminsdk.json` に保管する（リポジトリ外、gitに含まれない）。
- ローカルでAdmin SDKを使うスクリプト（`scripts/create-account.ts`等）を実行する際は `export GOOGLE_APPLICATION_CREDENTIALS=/home/yuki/.secrets/upsider-balance-adminsdk.json` を設定してから実行する。
- このキーを他の場所（ダウンロードフォルダ等）にコピーしたままにしない。作業後は都度確認して重複コピーを削除する。
- Firebase Web SDKのクライアント設定値（apiKey等）は `firebase apps:sdkconfig WEB <appId> --project upsider-balance` で取得できる。これは公開情報として扱ってよい値（クライアントに埋め込む前提のキー）であり、サービスアカウント鍵とは機密度が異なる。

## ブランチ・PR運用ルール（2026-07-24〜）
- ブランチ命名: `feat/xxx`, `fix/xxx`, `chore/xxx`, `docs/xxx` など Conventional Commits 準拠のプレフィックスを使う。
- 1 issue = 1ブランチ = 1PR を基本とする。作業が大きい場合はissue内でタスクを分割し、こまめに小さいPRを作ってマージしていく。
- コミットメッセージも同じプレフィックス規則（`feat:`, `fix:`, `chore:`, `docs:`）に従う。
- mainブランチへの直接pushは避け、PR経由でマージする（GitHub側のブランチ保護は現時点では未設定、運用ルールとして遵守する）。
- 既知の問題・将来的な技術的負債はGitHub issueとして起票し、`tech-debt`ラベルを付与する。優先度が低くても必ずissue化し、プロジェクトの見える化を保つ。

## 参照すべき設計文書
- [00_requirements.md](../design/00_requirements.md) — 要件定義
- [01_architecture.md](../design/01_architecture.md) — アーキテクチャ設計
- [02_security.md](../design/02_security.md) — セキュリティ設計
- [03_cost_estimate.md](../design/03_cost_estimate.md) — コスト試算
