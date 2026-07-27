# アーキテクチャ設計書 — UPSIDER残額共有アプリ

## 1. 全体構成図

```
┌──────────────────────┐
│  ブラウザ（スタッフ / admin） │
│  SvelteKit SPA           │
└──────────┬───────────┘
           │ HTTPS
           ▼
┌──────────────────────────────┐
│ Firebase Hosting                │
│  - 静的アセット配信（SvelteKit adapter-static）│
│  - /api/** を Cloud Functions にrewrite │
└──────────┬───────────────────┘
           │ rewrite (/api/**)
           ▼
┌──────────────────────────────┐
│ Cloud Functions for Firebase      │
│  単一エントリポイント（1関数）           │
│  export const api = onRequest(honoApp) │
│  Hono がその中で全ルーティングを担当     │
└───┬─────────────┬────────────┘
    │              │
    ▼              ▼
┌─────────┐   ┌─────────────┐
│ Firestore │   │ Firebase Storage │
│ 残額/履歴/  │   │ レシート画像      │
│ facility/  │   └─────────────┘
│ admin      │
└─────────┘
    │
    ▼（サーバー側のみ）
┌─────────────┐
│ Gemini API      │
│ (画像解析)       │
└─────────────┘
```

要点：
- Cloud Functions は **1つの HTTPS 関数** に集約し、内部で Hono がルーティングする（`onRequest` 1個 + Hono）。関数のコールドスタート数やデプロイ管理を最小化し、コストも「関数1個ぶんの呼び出し課金」に単純化できる。
- Cloud Run 常駐は使わない。Cloud Functions for Firebase（第2世代、内部的にはCloud Run基盤だが `minInstances: 0` 設定でオンデマンド化）を採用し、アイドル時課金ゼロを維持する。
- SvelteKit のビルド出力は `adapter-static`（完全SPA化）を第一候補とする。

### SvelteKit adapterの選定（要検討）
- **確定: `@sveltejs/adapter-static`** でSPA化し、Firebase Hostingの静的配信のみで完結させる（ユーザー確認済み、2026-07-24）。
  - 理由: 施設内共用端末での利用が中心で、SEOやSSRの初期表示速度が重要な要件ではない。SSRをCloud Functionsで行うと関数呼び出し回数・実行時間が増えコストが上がる。静的配信は無料枠内に収まりやすい。
  - 認証情報を必要とする画面はクライアントサイドでFirebase Authの状態を見てから描画する。初回ロード時のログイン画面の一瞬のちらつきは許容する方針とした。

---

## 2. 認証方式の具体設計

### 2.1 候補比較

| 観点 | (a) 施設IDを擬似メールアドレス化してEmail/Password認証 | (b) 自前パスワード検証＋Admin SDKでカスタムトークン発行 |
|---|---|---|
| 実装コスト | 低。Firebase Authが用意するEmail/Password機構をそのまま使える | 中。パスワード検証ロジック、ハッシュ保存、Firestore管理が別途必要 |
| パスワードの保存場所 | Firebase Auth内部（Google管理） | 自前Firestore（アプリ側でハッシュ化・検証を実装） |
| admin/施設ロール分離 | Custom Claimsで分離可能（例: `role: "facility" | "admin"`） | 同様にCustom Claimsで分離可能 |
| 長期セッション実現 | Firebase Authのidトークン(1時間)+リフレッシュトークン(SDKが自動更新、実質無期限)をそのまま使える | 最終的にはFirebase AuthのIDトークン/リフレッシュトークンに交換されるため同様に実現可能だが実装が二重になる |
| 総当たり対策 | Firebase Authのレート制限を活用できる | 自前でthrottle等を実装する必要がある |
| 運用コスト | Firebase Auth無料枠内（今回はfacility 1件+admin少数のため無視できる規模） | 同左 |

### 2.2 推奨案

**(a) 施設ID/adminIDを擬似メールアドレス化してEmail/Password認証を使う方式を推奨する。**

理由:
1. パスワードの保存・検証・レート制限・総当たり対策をすべてFirebase Authに委譲でき、自前実装によるセキュリティ事故のリスクを最小化できる。
2. 長期セッション要件（共用端末で数週間〜数ヶ月）は、Firebase AuthのクライアントSDKが自動的にリフレッシュトークンを使ってIDトークンを更新し続けるため、追加実装なしで満たせる。
3. カスタムトークン方式(b)は自前でパスワードハッシュの保存・検証ロジックを持つ必要があり、実装・監査コストが上がる。今回の規模ではオーバースペック。

具体設計:
- 施設アカウント: `facility-<facilityId>@login.upsider-balance.internal` のような疑似メールをUIDのメールとして登録。ユーザーには見せず、ログインフォームには「施設ID」「PASS」の2フィールドのみを見せ、クライアント側でメール形式に変換してから`signInWithEmailAndPassword`を呼ぶ。
- adminアカウント: `admin-<adminId>@login.upsider-balance.internal` の別プレフィックスとし、Firestoreの`admins`コレクションと1:1で対応させる。**ロールの判定はメールアドレスの命名規則だけに頼らず、必ずCustom Claims（`{ role: "admin" }` または `{ role: "facility", facilityId: "xxx" }`）で行う**ことで権限昇格を防ぐ。
- Custom Claimsの設定タイミング: ユーザー作成（初期セットアップ、Firebase Admin SDK経由）時に`setCustomUserClaims`で設定する。セルフサインアップは提供しない。
- ロール検証フロー: クライアントはログイン後にIDトークンを取得 → Honoの各APIへの呼び出し時に`Authorization: Bearer <idToken>`を付与 → Hono側でAdmin SDKの`verifyIdToken`を使いClaimsの`role`と（施設の場合）`facilityId`を検証してから処理する。

### 2.3 長期セッションの実現方法
- Firebase AuthのIDトークンの有効期限は1時間だが、クライアントSDKは自動的にリフレッシュトークンでサイレント更新を行う。リフレッシュトークン自体はデフォルトで無期限（Google側の異常検知やパスワード変更等がない限り失効しない）。
- 共用端末でのログアウト忘れリスクに配慮し、明示的な「ログアウト」ボタンをUIに用意する。
- **確定方針**: 施設側・admin側ともに標準の長期セッション（SDK標準永続化）を採用する（ユーザー確認済み、2026-07-24）。admin側のみ短命セッションにする案は不採用。

---

## 3. Firestoreデータモデル

単一施設運用が前提だが、将来のマルチテナント拡張を見据え、全ドキュメントに `facilityId` を持たせる（過剰設計はしない範囲での配慮）。

### 3.1 コレクション構成

```
facilities/{facilityId}
  - name: string                    施設名（表示用）
  - loginId: string                  施設ログインID（表示・照合用、一意）
  - authUid: string                   対応するFirebase AuthのUID
  - createdAt: Timestamp
  - updatedAt: Timestamp

facilities/{facilityId}/balance/current   単一ドキュメントで残額を保持
  - amount: number                    現在残額（円、整数）
  - updatedAt: Timestamp
  - updatedBy: "system" | "admin"      直近更新者種別（個人識別はしない）

facilities/{facilityId}/purchases/{purchaseId}
  - amount: number                     購入金額（円、整数）
  - storeName: string | null            購入店舗名（任意、2026-07-25追加：品目メモとは別管理）
  - memo: string | null                 購入品目メモ（任意）
  - purchasedAt: Timestamp               購入日時（デフォルト現在時刻、入力可能）
  - receiptImagePath: string | null       Storageパス（レシート解析を使った場合）
  - receiptOcrRaw: object | null          Gemini解析結果の生データ（任意保持）
  - createdAt: Timestamp
  - updatedAt: Timestamp
  - editedByAdmin: boolean                admin編集済みフラグ（任意）
  - facilityId: string                    非正規化（将来の横断集計・コレクショングループクエリ用）

admins/{adminId}
  - loginId: string                      adminログインID
  - authUid: string                       対応するFirebase AuthのUID
  - createdAt: Timestamp

# 監査ログ（任意、コスト影響を見て要否判断）
auditLogs/{logId}
  - actorRole: "admin"
  - actorId: string                        adminId
  - action: "balance_update" | "purchase_edit" | "purchase_delete"
  - targetPath: string                      対象ドキュメントのパス
  - before: object | null
  - after: object | null
  - createdAt: Timestamp
```

### 3.2 設計メモ

- **残額はサブコレクション内の単一ドキュメント (`balance/current`) に保持**し、購入登録のたびにトランザクション（`runTransaction`）で「残額の減算」と「purchases への追加」を同時に行う。これにより残額とpurchases履歴の合計にズレが生じないようにする。
- 残額をpurchasesの合計から都度計算する設計も可能だが、履歴が増えると読み取りコストが増大するため、**残額は都度更新のスナップショットとして保持する方式を推奨**。
- `purchases` コレクションは施設ごとにサブコレクション化し、Firestoreセキュリティルールでの`facilityId`一致チェックをパス自体で自然に表現できるようにする。
- インデックス: `purchases` の一覧表示は `purchasedAt desc` の単純ソートのみのため追加の複合インデックスは不要。将来「日付範囲＋金額」等の複合条件が必要になれば追加する。
- **要検討**: 監査ログ（`auditLogs`）は要件定義書には明記されていない。admin操作の追跡可能性を持たせたい場合の任意機能として提案するが、コスト最小化とのトレードオフがあるため実装要否はユーザー判断としたい。

---

## 4. Hono API設計

ベースパス: `/api`（Firebase Hostingの`rewrites`で`/api/**`をCloud Functionsにルーティング）

| メソッド | パス | 認証 | 概要 |
|---|---|---|---|
| GET | `/api/balance` | 施設 or admin | 現在残額取得 |
| POST | `/api/purchases` | 施設 or admin | 購入登録（金額・メモ・購入日時・レシート画像パス）。トランザクションで残額減算＋履歴追加 |
| GET | `/api/purchases` | 施設 or admin | 購入履歴一覧取得（ページネーション、`purchasedAt desc`） |
| PATCH | `/api/admin/balance` | adminのみ | 残額の直接編集（上書き・増減） |
| PATCH | `/api/admin/purchases/:id` | adminのみ | 購入履歴の編集 |
| DELETE | `/api/admin/purchases/:id` | adminのみ | 購入履歴の削除。トランザクションで残額に金額を再加算する（確定方針） |
| POST | `/api/receipts/analyze` | 施設 or admin | Storage上の画像パスを受け取り、Gemini Vision APIで解析、結果をJSONで返す（フォームプリフィル用） |
| GET | `/api/admin/facility` | adminのみ | 施設設定情報取得（名称程度） |

### 4.1 認証必須の判定方法
- すべての `/api/**` エンドポイントでAuthorizationヘッダのIDトークンをHono側ミドルウェアで検証（`verifyIdToken`）。
- ロール別の追加チェックをルートごとのミドルウェアで実施（`requireRole("admin")`等）。
- ログイン自体はFirebase Auth SDKがクライアントから直接行うため、Hono側に「ログインAPI」は不要。

### 4.2 確定事項
- **購入削除時の残額再加算**: 削除時に該当購入の金額を残額へ再加算する。編集時も差分を残額に反映する。いずれもFirestoreトランザクションで「purchasesの更新/削除」と「balanceの更新」をアトミックに行う。

---

## 5. レシート画像解析フロー

```
1. スタッフがレシート写真を選択
2. クライアント（SvelteKit）が Firebase Storage に直接アップロード
   （Firebase AuthのIDトークンを持つユーザーとしてクライアントSDK経由でアップロード。
    Storageセキュリティルールで自施設パス（facilities/{facilityId}/receipts/**）以外への
    書き込みを拒否）
3. アップロード完了後、クライアントは Storage のパスを
   Hono の POST /api/receipts/analyze に送信
4. Hono（Cloud Functions）が Firebase Admin SDK 経由でStorageからファイルを取得
5. Hono サーバー内から Gemini API（Vision機能）を呼び出す。
   APIキーはCloud Functionsの環境変数/Secret Manager経由で保持し、クライアントには一切渡さない
6. Geminiの応答（金額候補・店舗名・品目候補）をパースし、構造化JSONとしてクライアントに返却
7. クライアントはその内容を「購入登録」フォームにプリフィルし、スタッフが確認・修正
8. スタッフが最終確定して POST /api/purchases を呼び、purchases ドキュメントに
   receiptImagePath（Storageパス）と（任意で）receiptOcrRaw（Geminiの生応答）を保存
```

- Gemini APIキーの秘匿のため、呼び出しは必ずHono（サーバー側）経由とする。
- 画像のアップロード自体はクライアントからStorageへ直接行い、Cloud Functionsを経由させない（Functionsの実行時間・帯域課金を避けるため）。Hono経由にするのは「解析リクエスト」のみとする。
- **要検討**: Gemini APIを「Gemini API（AI Studio、APIキー方式）」と「Vertex AI経由（GCPプロジェクト統合、IAM認証）」のどちらで呼ぶか。コスト試算（別文書）を踏まえて実装フェーズで確定させる。

---

## 6. ディレクトリ構成案（pnpm workspaces モノレポ）

```
upsider-balance/
├── package.json                 # workspaces定義のルート
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── firebase.json                 # Hosting rewrites, Functions, Firestore/Storage rules指定
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── docs/
│   └── design/
│       ├── 00_requirements.md
│       ├── 01_architecture.md
│       ├── 02_security.md
│       └── 03_cost_estimate.md
├── packages/
│   ├── web/                      # SvelteKitアプリ
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── +page.svelte          # 施設ログイン
│   │   │   │   ├── dashboard/            # 残額表示・購入登録・履歴
│   │   │   │   └── admin/                # admin専用ルート
│   │   │   ├── lib/
│   │   │   │   ├── firebase.ts           # Firebase Client SDK初期化
│   │   │   │   ├── api-client.ts         # Hono APIへのfetchラッパー
│   │   │   │   └── stores/
│   │   │   └── app.html
│   │   ├── svelte.config.js       # adapter-static設定
│   │   └── package.json
│   │
│   ├── functions/                 # Hono + Cloud Functions
│   │   ├── src/
│   │   │   ├── index.ts             # export const api = onRequest(app.fetch)
│   │   │   ├── app.ts               # Honoアプリ本体、ルーティング集約
│   │   │   ├── routes/
│   │   │   │   ├── balance.ts
│   │   │   │   ├── purchases.ts
│   │   │   │   ├── admin.ts
│   │   │   │   └── receipts.ts
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts          # verifyIdToken, requireRole
│   │   │   ├── lib/
│   │   │   │   ├── firestore.ts     # Admin SDK初期化
│   │   │   │   ├── gemini.ts        # Gemini API呼び出しラッパー
│   │   │   │   └── storage.ts
│   │   │   └── types/
│   │   └── package.json
│   │
│   └── shared/                     # 共有型定義（Firestoreドキュメント型、APIレスポンス型等）
│       ├── src/
│       │   └── types.ts
│       └── package.json
│
└── README.md
```

- `packages/shared` にFirestoreドキュメント型・APIのリクエスト/レスポンス型を集約し、`web`と`functions`の両方から`workspace:*`で参照して型のズレを防ぐ。
- `firebase.json`の`hosting.rewrites`で`/api/**` → `functions:api` にルーティングし、SvelteKitの静的ビルド出力を`hosting.public`に指定する。

---

## 7. 将来のマルチテナント拡張余地

今回は単一施設のみだが、大きな手戻りを避けるため以下の配慮をデータモデル・API設計に含めている（過剰設計はしない、コメント程度）。

- Firestoreの全主要ドキュメントを `facilities/{facilityId}/...` のサブコレクション構造にしており、施設が増えても構造の変更なしに対応できる。
- `purchases` ドキュメントに `facilityId` フィールドを非正規化して持たせているため、将来「全施設横断の集計」が必要になった場合にコレクショングループクエリで対応可能。
- Custom Claimsに`facilityId`を含める設計にしているため、複数施設が増えても「どの施設に属するユーザーか」の判定ロジックは変更不要。
- adminロールは今回「単一のadmin群」だが、将来的に「施設ごとのadmin」が必要になった場合は、`admins`ドキュメントに`facilityId`（null許容）フィールドを追加するだけで対応できる設計余地を残す（現時点では実装しない）。

---

## 8. 確定事項まとめ（2026-07-24 ユーザー確認済み）

1. SvelteKitのレンダリング方式：`adapter-static`（SPA）で確定。ログイン画面の一瞬のちらつきは許容。
2. セッション方式：施設・admin共に長期セッション（SDK標準永続化）。
3. 購入履歴削除時：残額を再加算する。
4. 監査ログ（`auditLogs`）：実装しない（初回リリーススコープ外）。
5. Gemini API呼び出し方式：コスト試算（`03_cost_estimate.md`）によりGemini 2.5 Flashを想定。AI Studio APIキー方式で実装（Vertex AI経由は将来検討）。
