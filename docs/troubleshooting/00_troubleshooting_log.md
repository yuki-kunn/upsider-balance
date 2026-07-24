# トラブルシューティングログ — UPSIDER残額共有アプリ

開発中に発生した問題とその解決策を時系列で記録する。セッションがリセットされても、同じ問題を再発見・再調査する無駄を避けるために使う。

記入フォーマット：

```
## YYYY-MM-DD 問題の短い要約
- 症状:
- 原因:
- 解決策:
- 関連ファイル:
```

---

## 2026-07-24 SvelteKitのvite.config.tsでsveltekitプラグインのimport元を間違える
- 症状: ビルド時にエラーが発生（`sveltekit`プラグインが正しく解決されない）。
- 原因: `@sveltejs/vite-plugin-svelte` から `sveltekit` をimportしていたが、これは誤り。
- 解決策: `sveltekit` は `@sveltejs/kit/vite` からexportされている。`import { sveltekit } from '@sveltejs/kit/vite';` に修正する。
- 関連ファイル: `packages/web/vite.config.ts`

## 2026-07-24 pnpmがグローバルインストールできない（権限エラー）
- 症状: `npm install -g pnpm` が `EACCES` 相当の権限エラーで失敗（`/usr/local/lib/node_modules` に書き込み権限がない）。
- 原因: グローバルnode_modulesディレクトリがrootまたは別ユーザー所有。
- 解決策: `corepack enable --install-directory ~/.local/bin` の後 `corepack prepare pnpm@latest --activate` を実行し、`~/.local/bin` をPATHに追加する（`.bashrc`に追記）。sudoは使わない。
- 関連ファイル: `~/.bashrc`

## 2026-07-24 admin.tsのDELETE /admin/purchases/:idで残額バリデーションが欠落
- 症状: コードレビューで発見。PATCH /admin/balanceとPATCH /admin/purchases/:idは計算後の残額に`assertValidAmount`を適用していたが、DELETE /admin/purchases/:idだけ適用されておらず、購入ドキュメントのamountが破損データ（NaN等）だった場合に残額がNaNのまま書き込まれる恐れがあった。
- 原因: 3つのadmin残額変更経路（PATCH balance / PATCH purchase / DELETE purchase）でバリデーション適用に一貫性がなかった。
- 解決策: DELETE内のトランザクションで`assertValidAmount(newBalanceAmount, ...)`を追加。
- 関連ファイル: `packages/functions/src/routes/admin.ts`

## 2026-07-24 receiptOcrRawがサイズ・型検証なしでFirestoreに保存されていた
- 症状: `POST /purchases`の`receiptOcrRaw`はクライアント入力をそのまま`?? null`でFirestoreに保存しており、amount/memoのような検証がなかった（02_security.md 5章の「Gemini抽出結果も外部由来として扱いサニタイズする」方針に反する）。
- 原因: 実装時にamount/memo/purchasedAtにはバリデーションを追加したが、receiptOcrRawだけ見落とされた。
- 解決策: `lib/validation.ts`に`sanitizeReceiptOcrRaw`（オブジェクト型チェック＋20KBサイズ上限）を追加し、purchases.tsで適用。
- 関連ファイル: `packages/functions/src/lib/validation.ts`, `packages/functions/src/routes/purchases.ts`

## 2026-07-24 Gemini呼び出し失敗時のエラーログにAPIキー漏洩の懸念
- 症状: `routes/receipts.ts`の catch節で`console.error("...", err)`とエラーオブジェクト全体をログ出力していた。Google系SDKのエラーオブジェクトにはリクエスト情報（クエリパラメータ等）が付随することがあり、APIキーがCloud Loggingに漏れる可能性が指摘された。
- 原因: 他のルートと同じパターンで実装したが、Gemini呼び出しを含むこのルートだけ特別扱いが必要だった。
- 解決策: `err instanceof Error ? err.message : "unknown error"`でメッセージ文字列のみを抽出してログ出力するよう変更。
- 関連ファイル: `packages/functions/src/routes/receipts.ts`

## 2026-07-24 facilityId解決ロジックが3ファイルに重複実装されていた
- 症状: `role === "facility" ? authUser.facilityId : resolveSoleFacilityId(db)`というパターンがbalance.ts/purchases.ts/receipts.tsにそれぞれ独立して実装されており、将来のマルチテナント化時に1箇所の修正漏れが起きるリスクがあった。
- 原因: 各ルートを並行実装した際、共通化の判断が個別エージェントに委ねられ統一されなかった。
- 解決策: `lib/facility.ts`を新設し、`resolveSoleFacilityId`と`resolveFacilityIdForUser`を集約。4ファイル全てがここからimportする構成に統一。
- 関連ファイル: `packages/functions/src/lib/facility.ts`, `packages/functions/src/routes/{balance,purchases,admin,receipts}.ts`

## 2026-07-24 packages/functions/.gitignoreの`lib/`がsrc/lib/まで除外していた
- 症状: 初回git addで`packages/functions/src/lib/`配下（facility.ts, firestore.ts, gemini.ts, validation.ts）がステージされなかった。
- 原因: `packages/functions/.gitignore`に`lib/`とだけ書いていたため、ビルド出力先の`packages/functions/lib/`だけでなく、任意階層の`lib`ディレクトリ（`src/lib/`含む）にマッチしてしまった。
- 解決策: `lib/`を`/lib/`（パッケージルートからの相対パス指定）に変更し、ビルド出力のみを除外するようにした。
- 関連ファイル: `packages/functions/.gitignore`

## 2026-07-24 WSL環境でFirestore/Authエミュレータが起動できない（Java未インストール）
- 症状: `firebase emulators:start`実行時に`Error: Could not spawn 'java -version'. Please make sure Java is installed and on your system PATH.`
- 原因: Firestore/Authエミュレータの実体（Javaベース）を動かすJREが環境に無く、sudoパスワードが必要でインストールもできなかった。
- 解決策: エミュレータ検証は行わず、実際のFirebaseプロジェクト（upsider-balance）に対してテストアカウントを作成し動作検証する方針に切り替えた。検証後はテストデータをクリーンアップした。今後Java環境が整えば `apt install default-jre` 等でエミュレータを有効化できる。
- 関連ファイル: なし（環境起因の制約）

## 2026-07-24 Admin SDKローカル実行時に`auth/configuration-not-found`
- 症状: サービスアカウント鍵を使ってAdmin SDKからFirebase Authを操作しようとすると`There is no configuration corresponding to the provided identifier.`（`auth/configuration-not-found`）で失敗した。
- 原因: Firebase ConsoleでAuthenticationサービス自体をまだ有効化していなかった（プロジェクト作成直後はAuthenticationが未初期化の状態）。
- 解決策: Firebase Console → Authentication → 「始める」でサービスを有効化し、Sign-in methodで「メール/パスワード」を有効化した。
- 関連ファイル: なし（Firebase Console側の設定）

## 2026-07-24 Admin SDKローカル実行時に`initializeApp()`だけではprojectIdが解決されない
- 症状: `GOOGLE_APPLICATION_CREDENTIALS`環境変数を設定していても、引数なしの`initializeApp()`では`There is no configuration corresponding to the provided identifier.`エラーが出た。
- 原因: ローカルNode.js実行環境では、Cloud Functions実行環境のような自動的なprojectId解決が働かないケースがある。
- 解決策: `scripts/create-account.ts`で、`GOOGLE_APPLICATION_CREDENTIALS`が指すJSONファイルを`readFileSync`で読み込み、`cert(serviceAccount)`と`projectId: serviceAccount.project_id`を明示的に`initializeApp()`に渡すよう変更した。
- 関連ファイル: `scripts/create-account.ts`

## 2026-07-24 web/src/lib/auth.tsとscripts/create-account.tsで疑似メール変換ロジックが不一致だった（issue #14）
- 症状: Sprint2着手時に発見。フロントエンドの`facilityIdToEmail`/`adminIdToEmail`が`facility-${id}@login.upsider-balance.internal`形式を生成していたが、実際にSprint1で動作検証したアカウント作成スクリプトは`${id}@facility.upsider-balance.local`形式だった。このままではフロントエンドからのログインが常に失敗する。
- 原因: Sprint0でweb/functionsパッケージを並行実装した際、各担当が設計書の記述を独自解釈し、ドメイン・プレフィックス形式が揃わなかった。Sprint1でcreate-account.ts側だけ動作検証し、auth.ts側との整合確認をしていなかった。
- 解決策: `packages/web/src/lib/auth.ts`を`scripts/create-account.ts`の実装（動作検証済みの方）に合わせて修正。
- 再発防止: 変換ロジックの共通化をissue #15として起票。
- 関連ファイル: `packages/web/src/lib/auth.ts`, `scripts/create-account.ts`

## 2026-07-24 開発サーバーで /api/** がCloud Functionsに届かない
- 症状: `vite dev`だけを起動しても、ダッシュボードからのAPI呼び出し（`/api/balance`等）が404になる。
- 原因: 本番はFirebase Hostingの`rewrites`設定（`/api/**` → Cloud Functions）が処理するが、開発サーバーにはその仕組みがない。
- 解決策: `packages/web/vite.config.ts`に`server.proxy`を追加し、`/api`宛のリクエストを`http://localhost:5001`（ローカルで起動したHono/Functions）にプロキシしてパスの`/api`プレフィックスを剥がすようにした。
- 関連ファイル: `packages/web/vite.config.ts`

## 2026-07-24 WSL環境でlocalhost名前解決がIPv6優先になりcurl/Playwrightが接続失敗する
- 症状: `curl http://localhost:5173/`や、Playwrightで`page.goto("http://localhost:5173/")`が接続失敗・タイムアウトすることがあった。
- 原因: WSL環境で`localhost`が`::1`(IPv6)に先に解決され、実際にリッスンしているのはIPv4のみだったため接続が失敗していた。
- 解決策: 動作確認・自動化スクリプトでは`localhost`ではなく`127.0.0.1`を明示的に使う。
- 関連ファイル: なし（環境起因の制約、検証スクリプト側で回避）

## 2026-07-24 Firebase Cloud Functions(Gen2)のIAM invoker権限が個人プロジェクトで付与できずFirebase Hostingを断念、Vercelに移行
- 症状: `firebase deploy --only hosting,functions`は成功するが、Firebase Hosting経由・Cloud Run直URL経由のいずれもAPI呼び出しが全て401（GFEレベルの`Your client does not have permission to the requested URL`）になった。Cloud ConsoleのIAM画面で`allUsers`や`service-<project>@gcp-sa-firebasehosting.iam.gserviceaccount.com`にCloud Run起動元ロールを付与しようとしても「タイプがallUsersやallAuthenticatedUsersのプリンシパルをこのリソースに追加することはできません」等のエラーで拒否された。Cloud Functions側の`onRequest`に`invoker: "public"`を指定して再デプロイしても解消しなかった。
- 原因: 2024年末以降に作成されたGoogle Cloudプロジェクトでは、Cloud Runサービスへの未認証アクセスを制限するセキュリティベースライン（`run.managed.requireInvokerIam`相当）がデフォルトで有効になっており、個人アカウントでもallUsers等の追加がブロックされる。サービスアカウント経由でのIAMポリシー確認・操作も権限不足（`run.services.getIamPolicy`が無い）で行えなかった。
- 解決策: Firebase Hosting + Cloud Functionsでのバックエンドホスティングを断念し、Hono APIをSvelteKitの`routes/api/[...path]/+server.ts`に統合してVercelにデプロイする構成に変更した。Firestore/Storage/Firebase Authenticationは引き続きFirebase側で運用し、Admin SDK（Vercel環境ではサービスアカウント鍵をJSON文字列の環境変数`FIREBASE_SERVICE_ACCOUNT_KEY`として渡す）・Client SDKからアクセスする。
- 関連ファイル: `packages/web/src/lib/server/**`（旧`packages/functions/src`から移設）, `packages/web/src/routes/api/[...path]/+server.ts`, `firebase.json`（hosting/functionsセクション削除）, `packages/functions/`（削除）

## 2026-07-24 Honoアプリのルーティングパスと`+server.ts`委譲先のパスが不一致で404
- 症状: Vercel移行後、`/api/balance`等が全て404になった。
- 原因: Honoアプリ（`app.ts`）はCloud Functions時代の名残で`/balance`等をルートパスとしてルーティングしていたが、SvelteKitの`routes/api/[...path]/+server.ts`はリクエストをそのまま（`/api/balance`のまま）`app.fetch()`に渡していたため、Honoのルーティングと一致しなかった。
- 解決策: `new Hono().basePath("/api")`でHonoアプリ自体に`/api`プレフィックスを吸収させ、`app.route("/balance", ...)`等はそのままで`/api/balance`にマッチするようにした。
- 関連ファイル: `packages/web/src/lib/server/app.ts`

## 2026-07-24 Vercel環境変数を`--sensitive`（デフォルト）で登録するとvercel pull/buildで実際の値が取得できない
- 症状: `vercel env add`で登録したFirebase Web SDK設定（`VITE_FIREBASE_API_KEY`等）が、`vercel pull`後のローカルの`.vercel/.env.production.local`に実際の値ではなく文字列`"[SENSITIVE]"`として書き込まれ、そのままビルドに埋め込まれてしまい、本番で`Firebase: API key not valid`エラーになった。
- 原因: Vercelの環境変数にはSensitive（デフォルト）とNon-sensitiveの区別があり、Sensitiveタイプはvercel CLIの`pull`/`build`では値をローカルに一切降ろさない設計（値の再表示・取得ができない）になっている。クライアントサイドに埋め込む前提の`VITE_`変数をSensitiveのまま登録すると、ローカルビルドでは常にプレースホルダーが使われてしまう。
- 解決策: 該当の環境変数を`vercel env rm`で削除し、`vercel env add <name> production --no-sensitive --value "<value>" --yes`でNon-sensitiveとして再登録した。クライアントに公開される前提の値（Firebase Web SDK設定等）はNon-sensitiveで登録し、`FIREBASE_SERVICE_ACCOUNT_KEY`のようなサーバー専用の機密情報はSensitiveのままにする。
- 関連ファイル: Vercelプロジェクト環境変数設定（コードファイルへの変更なし）

## 2026-07-24 gemini-2.5-flashが新規APIキーでは404 (NOT_FOUND)
- 症状: Gemini APIキー発行後、`lib/gemini.ts`で指定していた`gemini-2.5-flash`モデルを呼び出すと`This model models/gemini-2.5-flash is no longer available to new users.`という404エラーが返った。`GET /v1beta/models`の一覧には`gemini-2.5-flash`自体は表示されるが、新規発行のAPIキーでは実際には呼び出せない状態だった。
- 原因: Googleが`gemini-2.5-flash`を新規ユーザー向けには提供終了しており、一覧表示と実際の利用可否が一致していなかった（既存ユーザーの後方互換のためモデル名自体は残っている）。
- 解決策: `models.generateContent`の`model`パラメータを`gemini-3.5-flash`に変更した。テキスト生成・画像入力（inlineData）・`responseSchema`による構造化JSON出力のいずれも問題なく動作することを確認済み。
- 関連ファイル: `packages/web/src/lib/server/lib/gemini.ts`

## 2026-07-24 Firebase Admin SDKにstorageBucketを渡していなかったためレシート解析が失敗
- 症状: レシート画像アップロード後、`POST /api/receipts/analyze`が500エラー。サーバーログに`Bucket name not specified or invalid. Specify a valid bucket name via the storageBucket option when initializing the app...`
- 原因: `lib/firestore.ts`の`initializeApp()`で`credential`と`projectId`のみを渡しており、`storageBucket`オプションが未指定だった。サービスアカウント鍵JSON自体にはバケット名の情報が含まれないため、`getAdminStorage().bucket()`（デフォルトバケット取得）が失敗していた。
- 解決策: `initializeApp()`に`storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET`を追加し、クライアント用に既に設定していた環境変数をサーバー側でも流用するようにした。
- 関連ファイル: `packages/web/src/lib/server/lib/firestore.ts`

## 2026-07-24 Gemini日次レート制限が画像バリデーション失敗時にも消費されていた
- 症状: `/code-review`（Sprint5レビュー）で2つの独立エージェントから同一指摘。`POST /receipts/analyze`で`assertGeminiRateLimit`を画像の存在確認・MIME・サイズチェックより前に呼んでいたため、存在しないパスや不正な画像への連打だけで日次枠（50回/日）を消費でき、実際にGeminiを一度も呼ばずに正当な利用がレート制限される恐れがあった。
- 原因: レート制限チェックの実装時、「Geminiを呼ぶ直前でカウントする」という意図に対し、実装順序が画像バリデーションより先になっていた。
- 解決策: `assertGeminiRateLimit`の呼び出しを画像の存在確認・MIME・サイズチェックの後、Gemini呼び出し直前に移動。不正なリクエストを3回連打してもカウンタドキュメントが作成されないこと、正常な解析では正しくcount=1になることをE2Eで確認済み。
- 関連ファイル: `packages/web/src/lib/server/routes/receipts.ts`
