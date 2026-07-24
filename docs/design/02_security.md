# セキュリティ設計書 — UPSIDER残額共有アプリ

本書は `00_requirements.md` の要件（特に第6章）を受け、施設共用ID/PASS認証・adminロール分離・低コスト運用という制約の下でのセキュリティ設計を定める。技術スタック（SvelteKit + Hono + Firebase）の選定は変更しない。アーキテクチャ設計（`01_architecture.md`）とは認証方式（施設ID/adminIDの疑似メール化＋Firebase Auth＋Custom Claims）で方針が一致している。

## 1. 脅威モデル

| # | 脅威 | 想定シナリオ | 深刻度 |
|---|---|---|---|
| T1 | 施設ID/PASSの漏洩 | 共用端末の付箋・口頭伝達・退職スタッフによる漏洩 | 中 |
| T2 | 施設ID/PASSへの総当たり・辞書攻撃 | ログインAPIへの自動化された連続試行 | 高（アカウント数が少なく、IDが推測されやすい） |
| T3 | admin権限の奪取・権限昇格 | 施設アカウントでのログイン後、クライアント改ざんによりadmin用APIやFirestore書き込みを直接叩く | 高（残額改ざん・履歴削除に直結） |
| T4 | Firestore/Storageへの不正直接アクセス | 意図しないコレクション・他施設データへの読み書き（将来マルチテナント化時） | 中〜高 |
| T5 | レシート画像からの情報漏洩 | Storageの公開URL推測・共有によるレシート画像の第三者閲覧 | 中 |
| T6 | XSS | 購入メモ欄・品目名などの自由入力を経由したスクリプト注入 | 中 |
| T7 | CSRF | Cookieベースのセッションを採用した場合、他サイトからの偽装リクエストで購入登録・admin操作を実行される | 中 |
| T8 | セッション固定・長期トークンの窃取 | 共用端末に長期間残る認証情報が、端末紛失・共有PCの他利用者に悪用される | 中〜高（長期セッション要件のため発生確率が高い） |
| T9 | Gemini APIキーの漏洩・コスト濫用 | クライアントへのAPIキー露出、または無制限リクエストによる従量課金の膨張 | 中 |
| T10 | サービス濫用によるコスト攻撃（DoS/EDoS） | 大量リクエストでFirebase従量課金が急増 | 中 |

## 2. 認証・パスワード設計

### 2.1 推奨方式：Firebase Authentication + カスタムメールアドレスマッピング

施設ID/PASSおよびadmin ID/PASSは、いずれも**Firebase Authenticationのメール/パスワード認証を流用**する。

- 施設ID `xxx` → `xxx@facility.upsider-balance.local` のような非到達ダミードメインのメールアドレスにマッピングしてFirebase Authに登録する。
- admin ID `yyy` → `yyy@admin.upsider-balance.local` の別ドメインにマッピングする。facilityとadminでドメインを分離し、Custom Claims付与ミスや命名衝突を防ぐ。
- パスワードはFirebase Authenticationがサーバー側（Google管理下）でハッシュ化・保存する。**自前でのパスワードハッシュ実装は不要かつ非推奨**（実装ミスのリスク回避、無料枠内で利用可能、レート制限等の周辺機能も活用できるため）。
- このマッピング処理（ID→email変換、Custom Claims付与）はHono側（Cloud Functions）にログイン用エンドポイントを設け、そこでのみ実施する。フロントエンドは「施設ID＋PASS」「admin ID＋PASS」のフォームのみを扱う。

**要確認事項（発注者）**: 施設ID/adminIDが内部的にダミーメール形式に変換されること、本物のメールアドレスとして機能しないことを仕様として合意しておく必要がある。

### 2.2 ブルートフォース対策

| 対策 | 内容 |
|---|---|
| Firebase Authの標準保護 | メール/パスワード認証には既定で異常ログイン試行の検知・一時的制限が組み込まれている |
| アプリ側レート制限（推奨・追加実装） | Hono側のログインエンドポイントに、IPアドレス単位およびID単位でのレート制限を実装する。Firestoreに `loginAttempts/{facilityId}` ドキュメントを持たせ、直近N分間の失敗回数をカウント。例：5回失敗で15分ロックアウト、以降失敗ごとに待機時間を指数的に延長 |
| ロックアウト通知 | ロックアウト発生時、adminダッシュボードに警告表示 |
| CAPTCHA | 初期実装では見送り、攻撃兆候が見られた場合にreCAPTCHA v3等を追加する段階的対応でよい |
| パスワードポリシー | 最低8〜10文字、単純な数字列のみは禁止、程度の緩やかなポリシー。代わりにレート制限側で強く守る設計思想とする |

**要確認事項（発注者）**: 施設IDは単一施設運用のため推測が容易。「施設IDは公開情報として扱い、秘密はPASSのみに委ねる」設計思想を明示的に合意しておくことを推奨。

## 3. 認可・ロール設計

### 3.1 Custom Claimsによるロール表現

Firebase AuthenticationのCustom Claimsに `role: "facility"` または `role: "admin"` を設定する。付与はCloud Functions（Admin SDK）でのみ行い、クライアントからは変更不可能にする。

```js
await admin.auth().setCustomUserClaims(uid, { role: "facility" });
await admin.auth().setCustomUserClaims(uid, { role: "admin" });
```

Custom Claimsの変更はIDトークンに即時反映されないため、ロール変更操作を行った場合はクライアント側で `getIdToken(true)`（強制リフレッシュ）を要求する運用にする。本アプリでは施設・adminアカウントはほぼ固定運用（頻繁なロール変更なし）のため通常運用への影響は小さい。

### 3.2 Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() && request.auth.token.role == 'admin';
    }
    function isFacility() {
      return isSignedIn() && request.auth.token.role == 'facility';
    }
    function isStaffOrAdmin() {
      return isFacility() || isAdmin();
    }

    match /facilities/{facilityId}/balance/current {
      allow read: if isStaffOrAdmin();
      allow write: if false; // 増減はCloud Functions(Admin SDK)経由のみ。Rulesでは常に拒否
    }

    match /facilities/{facilityId}/purchases/{purchaseId} {
      allow read: if isStaffOrAdmin();
      allow write: if false; // create/update/deleteは全てCloud Functions経由に統一（3.4節参照）
    }

    match /loginAttempts/{docId} {
      allow read, write: if false; // Cloud Functions(Admin SDK)からのみ操作
    }

    match /auditLogs/{logId} {
      allow read, write: if false; // Cloud Functions(Admin SDK)からのみ操作
    }
  }
}
```

### 3.3 Storage Security Rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /facilities/{facilityId}/receipts/{fileName} {
      allow read: if request.auth != null
                  && (request.auth.token.role == 'facility' || request.auth.token.role == 'admin');
      allow write: if request.auth != null
                   && request.auth.token.role == 'facility'
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/(jpeg|png|webp|heic)');
      allow delete: if request.auth != null && request.auth.token.role == 'admin';
    }
  }
}
```

単一施設運用のためロールのみの絞り込みでも安全だが、将来のマルチテナント拡張（`01_architecture.md` 7章と整合）を見据え、パスに `facilityId` セグメントを最初から含めておく。実質コストゼロで拡張性を確保できる。

### 3.4 購入登録・残額増減はFunctions経由に統一（アーキ設計との整合）

要件6章の「Cloud Functions経由のみで許可」を受け、購入登録時の「履歴追加」と「残額減算」は**アトミックなトランザクションとして扱う**。

- **推奨・最終方針**: 購入登録・残額編集・履歴編集削除はすべてHono API（Cloud Functions）のエンドポイント経由のみとし、Functions内でFirestoreトランザクション（`runTransaction`）により「purchases追加/更新/削除」と「balance更新」を同時に行う。クライアントからの直接書き込みはFirestore Rules上すべて `if false` とし、Admin SDK（Functions）のみが書き込み可能とする。
- 理由：
  - 残額とのアトミック性がRulesだけでは保証できない
  - バリデーション（金額範囲、サニタイズ等）をサーバー側で一元管理できる
  - 監査ログ・レート制限ロジックを一箇所に集約できる

この方針は `01_architecture.md` のAPI設計（4章）と整合させ、購入履歴削除時の残額再加算方針（要検討事項）もFunctions側のトランザクション処理として実装する。

## 4. セッション管理

### 4.1 要件との整合

Firebase AuthenticationのIDトークンは有効期限1時間の短命トークンだが、リフレッシュトークン自体はデフォルトで長期間有効なため、要件の「数週間〜数ヶ月の長期セッション」はクライアントSDKの標準動作（`browserLocalPersistence`）で自然に満たせる。

### 4.2 クライアント側トークン保存方式

| 方式 | 特徴 | 採用可否 |
|---|---|---|
| Firebase Auth SDKの `browserLocalPersistence` | SDKが自動でリフレッシュトークン管理・ID再取得を行う。実装がシンプル | ○ 基本方針として採用 |
| httpOnly Cookie + サーバーセッション | XSSからの資格情報窃取に強い。CSRF対策が別途必要 | 要検討（4.3参照） |
| localStorageへの独自トークン保存 | 自前管理、XSSに弱い | 非推奨 |

**確定方針**: 施設側・admin側ともにFirebase Auth SDKの標準永続化（長期セッション）を採用する。ユーザー確認の結果、adminも運用上頻繁にログインする想定のため、施設側と同様の長期セッションとする（4.3節のセッションCookie短命化案は不採用）。

- ログアウトボタンを明示的に用意し、「最後の退勤者がログアウトする」等の運用ガイドを別途ドキュメント化する。
- admin側が長期セッションになる分、admin IDのPASSは施設IDのPASSよりも強固なものを設定する運用を推奨する（実装上の強制はしないが、初期セットアップ時のドキュメントで案内する）。

### 4.3 httpOnly Cookie採用の検討

Firebase Session Cookie機能（`createSessionCookie`）を使い、Hono側でhttpOnly・Secure・SameSite=Strict属性のCookieを発行する方式も選択可能。XSS発生時の被害軽減になるがCSRF対策の実装コストが増える。**初期実装ではSDK標準永続化を採用する。** httpOnly Cookie化はフェーズ2以降の見直し候補とする（admin/施設とも長期セッション方針が確定したため、Cookie方式への移行は当面見送る）。

## 5. 入力値検証・サーバー側バリデーション

すべてのバリデーションはFirestore Rulesだけに頼らず、**Hono API側（サーバー）で必ず再検証する**。

| 項目 | 検証内容 |
|---|---|
| 購入金額 | 数値型、整数（円単位）、範囲チェック（例: -1,000,000〜10,000,000程度）。マイナス残高は要件上許容するが極端な値は弾く |
| 残額直接編集（admin） | 同上の型・範囲チェックに加え、変更前後の差分をログに残す（7章参照） |
| 購入品目メモ・店舗名 | 文字数上限（例: 200文字）、制御文字の除去。`{@html}` を使用しない実装ルールを徹底。サーバー側でも保存前にHTMLタグの無害化を行う。Gemini Vision APIの抽出結果も外部由来文字列としてユーザー入力に準ずる信頼度で同様に扱う |
| 購入日時 | ISO8601等の妥当な日時形式チェック、極端な未来・過去日付を拒否 |
| レシート画像 | ファイルサイズ上限（例: 10MB）、MIMEタイプ許可リスト（image/jpeg, image/png, image/webp, image/heic）をStorage Rulesとサーバー側の両方でチェック。拡張子偽装対策としてマジックバイト検証をFunctions側で行う |
| Gemini APIへの入力 | 画像サイズの事前圧縮・リサイズ（コスト対策も兼ねる）、レスポンスのプリフィル値も同様にサニタイズ対象とする |

## 6. APIキー・シークレット管理

- Gemini APIキーは**Firebase Functions のSecret Manager連携機能（`firebase functions:secrets:set`）を利用して管理**する。環境変数直書きや `.env` のリポジトリコミットは禁止。
- クライアント（SvelteKit）に直接Gemini APIキーを埋め込まない。画像解析は必ずHono API（Functions）経由でサーバーサイドから呼び出す。
- Gemini API呼び出し回数を日次・月次でFirestoreにカウントし、想定外の急増時にはFunctions側で呼び出しを拒否するソフトリミットを設ける。あわせてGoogle Cloud側の予算アラートを設定する。

## 7. 監査ログ（admin操作ログ）

**確定方針：監査ログは実装しない。** ユーザー確認の結果、シンプルさを優先し初回リリースのスコープから外すこととした。`auditLogs` コレクションおよび関連するFirestore Rules（`match /auditLogs/{logId}`）は設けない。将来的に不正操作の追跡ニーズが顕在化した場合に追加実装を検討する。

## 8. まとめ：確定方針一覧（2026-07-24 ユーザー確認済み）

| # | 項目 | 確定方針 |
|---|---|---|
| A | 施設ID/admin IDのFirebase Authマッピング方式 | ダミーメール形式でのメール/パスワード認証 |
| B | 施設IDの秘匿性 | IDは公開情報相当、PASSのみが秘密という設計思想 |
| C | 購入登録・残額増減の直接Firestore書き込み可否 | Functions経由に統一（クライアント直接書き込みは禁止） |
| D | 長期セッション vs admin再ログイン頻度 | 施設側・admin側ともに長期セッション |
| E | httpOnly Cookie化の採用時期 | 初期はSDK標準永続化のみ。将来の強化候補として保留 |
| F | 監査ログの実装要否 | 実装しない（初回リリーススコープ外） |
| G | 購入履歴削除時の残額再加算 | 再加算する（アーキ設計01の3.4/4.2節と合わせて実装） |
