# プロジェクトルール — UPSIDER残額共有アプリ

このファイルは全エージェント（Frontend/Backend/Infra/QA等）が開発中に遵守するルールを記録する。セッションがリセットされても、このファイルを読めば経緯とルールが分かるようにする。

## 決定事項の記録方法
- 仕様や設計に関する決定は `docs/design/` 配下の該当文書に追記する（このファイルには書かない）。
- 実装中に発覚した技術的な制約・回避策・ハマりどころは `docs/troubleshooting/` に追記する。
- 「今後全エージェントが従うべきルール」（コーディング規約、命名規則、ライブラリ選定の理由等）はこのファイルに追記する。

## 技術スタック（確定、2026-07-24 Vercel移行後）
- フロントエンド: SvelteKit（`adapter-vercel`、SSR構成）
- バックエンド: Hono（`packages/web/src/lib/server/`に統合し、`routes/api/[...path]/+server.ts`経由でSvelteKit API Routeとして実行）
- ホスティング: Vercel（web/API込みで単一デプロイ）
- DB/認証/ストレージ: Firestore / Firebase Authentication / Firebase Storage（引き続きFirebaseのマネージドサービスを利用。Admin SDKはサービスアカウント鍵を環境変数`FIREBASE_SERVICE_ACCOUNT_KEY`経由で初期化）
- 認証方式: 施設ID/adminIDを疑似メールに変換、Custom Claimsでロール管理（変更なし）
- 画像解析: Gemini 2.5 Flash（APIキーはVercelの環境変数`GEMINI_API_KEY`、サーバー側のみで呼び出す）
- モノレポ構成: pnpm workspaces（`packages/web`, `packages/shared`。`packages/functions`はVercel移行に伴い廃止・削除済み）

### Firebase Hostingを断念した経緯
当初はFirebase Hosting + Cloud Functions for Firebase構成だったが、Cloud Functions(Gen2)のIAM invoker権限（Cloud Runの未認証アクセス許可）が個人プロジェクトの新しいセキュリティベースラインでブロックされ、`allUsers`等の付与ができない問題に直面したためVercelに切り替えた。詳細は [00_troubleshooting_log.md](../troubleshooting/00_troubleshooting_log.md) の該当エントリを参照。

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

## Vercel環境変数の登録ルール
- クライアントに公開される前提の値（`VITE_`プレフィックス、Firebase Web SDK設定等）は `vercel env add <name> production --no-sensitive --value "<value>" --yes` で **Non-sensitive** として登録する。Sensitiveのままだと`vercel pull`/`vercel build`でプレースホルダー`"[SENSITIVE]"`しか取得できずビルドに実際の値が埋め込まれない（詳細は troubleshooting ログ参照）。
- サーバー専用の機密情報（`FIREBASE_SERVICE_ACCOUNT_KEY`, `GEMINI_API_KEY`）はデフォルトのSensitiveのまま登録してよい（クライアントバンドルに含まれないため）。
- ローカルでVercel本番相当のビルドを検証する場合は `vercel pull --yes --environment production` → `vercel build --prod` → `vercel deploy --prebuilt --prod` の順で行う。

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
