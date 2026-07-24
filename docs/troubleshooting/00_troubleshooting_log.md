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
