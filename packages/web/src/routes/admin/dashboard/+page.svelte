<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance, PurchaseListItem, AnalyzeReceiptResponse } from "@upsider-balance/shared";
  import { apiGet, apiPatch, apiPost, apiDelete } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { uploadReceiptImage } from "$lib/receipt-upload";
  import { millisToDateInput, dateInputToMillis, formatDate } from "$lib/date-format";
  import ReceiptImageCropper from "$lib/ReceiptImageCropper.svelte";

  const HISTORY_PREVIEW_COUNT = 3;

  let balance = $state<Balance | null>(null);
  let balanceError = $state("");
  /** レシートアップロード先パス組み立て用。adminのCustom Claimsにはfacilityidが無いため、
   * GET /balance のレスポンスから取得して保持しておく（uploadReceiptImageに明示的に渡す） */
  let facilityId = $state<string | null>(null);

  let balanceMode = $state<"amount" | "delta">("amount");
  let balanceInput = $state("");
  let balanceSubmitting = $state(false);
  let balanceSubmitError = $state("");

  // --- 購入登録（staff画面の購入登録フォームと同じもの） ---
  let newAmount = $state("");
  let newStoreName = $state("");
  let newMemo = $state("");
  let newPurchasedAt = $state(millisToDateInput(Date.now()));
  let newSubmitting = $state(false);
  let newSubmitError = $state("");

  let newReceiptFile = $state<File | null>(null);
  let newCameraFileInputRef = $state<HTMLInputElement | null>(null);
  let newGalleryFileInputRef = $state<HTMLInputElement | null>(null);
  let newReceiptImagePath = $state<string | null>(null);
  let newAnalyzing = $state(false);
  let newAnalyzeError = $state("");
  let newAnalyzeResult = $state<AnalyzeReceiptResponse | null>(null);
  /** ファイル選択直後、切り抜き調整のため一時的に保持する画像 */
  let newPendingCropFile = $state<File | null>(null);

  let purchases = $state<PurchaseListItem[]>([]);
  let historyLoading = $state(false);
  let historyError = $state("");

  let editingId = $state<string | null>(null);
  let editAmount = $state("");
  let editStoreName = $state("");
  let editMemo = $state("");
  let editPurchasedAt = $state("");
  /** 編集フォームは日付のみ変更可能。保存時は元のpurchasedAtの時刻部分をそのまま保持する */
  let editPurchasedAtOriginalMillis = $state(0);
  let editSubmitting = $state(false);
  let editError = $state("");

  let deletingId = $state<string | null>(null);
  let syncingId = $state<string | null>(null);
  let syncError = $state("");

  async function loadBalance() {
    try {
      const res = await apiGet<{ facilityId: string; balance: Balance }>("/balance");
      balance = res.balance;
      facilityId = res.facilityId;
      balanceError = "";
    } catch {
      balanceError = "残額の取得に失敗しました";
    }
  }

  /** adminダッシュボードでも直近件のみプレビュー表示する。全履歴は月別履歴ページで確認する */
  async function loadPurchases() {
    historyLoading = true;
    historyError = "";
    try {
      const res = await apiGet<{ purchases: PurchaseListItem[]; nextCursor: string | null }>(
        `/purchases?limit=${HISTORY_PREVIEW_COUNT}`,
      );
      purchases = res.purchases;
    } catch {
      historyError = "購入履歴の取得に失敗しました";
    } finally {
      historyLoading = false;
    }
  }

  onMount(() => {
    loadBalance();
    loadPurchases();
  });

  async function handleLogout() {
    await logout();
    await goto("/admin");
  }

  async function handleBalanceSubmit(event: SubmitEvent) {
    event.preventDefault();
    balanceSubmitError = "";

    const value = Number(balanceInput);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      balanceSubmitError = "金額は整数で入力してください";
      return;
    }

    balanceSubmitting = true;
    try {
      const body = balanceMode === "amount" ? { amount: value } : { delta: value };
      await apiPatch("/admin/balance", body);
      balanceInput = "";
      await loadBalance();
    } catch {
      balanceSubmitError = "残額の更新に失敗しました";
    } finally {
      balanceSubmitting = false;
    }
  }

  // --- 購入登録（staff画面のdashboard/+page.svelteと同じロジック） ---
  async function handleNewPurchaseSubmit(event: SubmitEvent) {
    event.preventDefault();
    newSubmitError = "";

    const amountValue = Number(newAmount);
    if (!Number.isFinite(amountValue) || !Number.isInteger(amountValue)) {
      newSubmitError = "金額は整数で入力してください";
      return;
    }
    const purchasedAtMillis = dateInputToMillis(newPurchasedAt, Date.now());
    if (purchasedAtMillis === null) {
      newSubmitError = "購入日を正しく入力してください";
      return;
    }

    newSubmitting = true;
    try {
      await apiPost("/purchases", {
        amount: amountValue,
        storeName: newStoreName.trim().length > 0 ? newStoreName.trim() : null,
        memo: newMemo.trim().length > 0 ? newMemo.trim() : null,
        purchasedAt: purchasedAtMillis,
        receiptImagePath: newReceiptImagePath,
        receiptOcrRaw: newAnalyzeResult?.raw ?? null,
      });
      newAmount = "";
      newStoreName = "";
      newMemo = "";
      newPurchasedAt = millisToDateInput(Date.now());
      newReceiptFile = null;
      if (newCameraFileInputRef) newCameraFileInputRef.value = "";
      if (newGalleryFileInputRef) newGalleryFileInputRef.value = "";
      newReceiptImagePath = null;
      newAnalyzeResult = null;
      await Promise.all([loadBalance(), loadPurchases()]);
    } catch {
      newSubmitError = "購入登録に失敗しました";
    } finally {
      newSubmitting = false;
    }
  }

  /** ファイル選択（カメラ撮影・ギャラリー選択いずれも）直後に切り抜き調整モーダルを挟む */
  function handleNewReceiptFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    newPendingCropFile = file;
  }

  function handleNewCropConfirmed(file: File) {
    newReceiptFile = file;
    newAnalyzeError = "";
    newAnalyzeResult = null;
    newReceiptImagePath = null;
    newPendingCropFile = null;
  }

  function handleNewCropCancelled() {
    newPendingCropFile = null;
  }

  async function handleNewAnalyzeReceipt() {
    if (!newReceiptFile) return;
    if (!facilityId) {
      newAnalyzeError = "施設情報を取得できませんでした。ページを再読み込みしてください";
      return;
    }
    newAnalyzeError = "";
    newAnalyzing = true;
    try {
      const path = await uploadReceiptImage(newReceiptFile, facilityId);
      newReceiptImagePath = path;
      const result = await apiPost<AnalyzeReceiptResponse>("/receipts/analyze", {
        receiptImagePath: path,
      });
      newAnalyzeResult = result;
      if (result.amountCandidates.length > 0) {
        newAmount = String(result.amountCandidates[0]);
      }
      if (result.storeNameCandidates.length > 0) {
        newStoreName = result.storeNameCandidates[0];
      }
      if (result.itemCandidates.length > 0) {
        newMemo = result.itemCandidates.join(" ");
      }
    } catch (e) {
      newAnalyzeError = e instanceof Error ? e.message : "レシート画像の解析に失敗しました";
    } finally {
      newAnalyzing = false;
    }
  }

  function startEdit(purchase: PurchaseListItem) {
    editingId = purchase.id;
    editAmount = String(purchase.amount);
    editStoreName = purchase.storeName ?? "";
    editMemo = purchase.memo ?? "";
    editPurchasedAt = millisToDateInput(purchase.purchasedAt);
    editPurchasedAtOriginalMillis = purchase.purchasedAt;
    editError = "";
  }

  function cancelEdit() {
    editingId = null;
    editError = "";
  }

  async function submitEdit(id: string) {
    editError = "";
    const amountValue = Number(editAmount);
    if (!Number.isFinite(amountValue) || !Number.isInteger(amountValue)) {
      editError = "金額は整数で入力してください";
      return;
    }
    const purchasedAtMillis = dateInputToMillis(editPurchasedAt, editPurchasedAtOriginalMillis);
    if (purchasedAtMillis === null) {
      editError = "購入日を正しく入力してください";
      return;
    }

    editSubmitting = true;
    try {
      await apiPatch(`/admin/purchases/${id}`, {
        amount: amountValue,
        storeName: editStoreName.trim().length > 0 ? editStoreName.trim() : null,
        memo: editMemo.trim().length > 0 ? editMemo.trim() : null,
        purchasedAt: purchasedAtMillis,
      });
      editingId = null;
      await Promise.all([loadBalance(), loadPurchases()]);
    } catch {
      editError = "購入履歴の更新に失敗しました";
    } finally {
      editSubmitting = false;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("この購入履歴を削除しますか？削除すると金額が残額に再加算されます。")) {
      return;
    }
    deletingId = id;
    try {
      await apiDelete(`/admin/purchases/${id}`);
      await Promise.all([loadBalance(), loadPurchases()]);
    } catch {
      historyError = "購入履歴の削除に失敗しました";
    } finally {
      deletingId = null;
    }
  }

  async function retryNotionSync(id: string) {
    syncError = "";
    syncingId = id;
    try {
      await apiPost(`/admin/purchases/${id}/notion-sync`, {});
      await loadPurchases();
    } catch {
      syncError = "Notionへの再送信に失敗しました";
    } finally {
      syncingId = null;
    }
  }

</script>

<div class="page">
  <header class="page-header">
    <div class="header-title">
      <h1>admin管理画面</h1>
      <span class="badge badge-warning">管理者</span>
    </div>
    <button class="btn btn-secondary btn-sm" onclick={handleLogout}>ログアウト</button>
  </header>

  <main class="page-body">
    <section class="card balance-card">
      <h2>現在残額</h2>
      {#if balanceError}
        <p class="alert alert-error" role="alert">{balanceError}</p>
      {:else if balance === null}
        <p class="text-muted">読み込み中…</p>
      {:else}
        <p class="balance-figure" class:is-negative={balance.amount < 0}>
          {balance.amount.toLocaleString()}<span class="unit">円</span>
        </p>
      {/if}
    </section>

    <section class="card">
      <h2>残額の編集</h2>
      <form onsubmit={handleBalanceSubmit}>
        <div class="radio-group" role="radiogroup">
          <label class="radio-option">
            <input type="radio" bind:group={balanceMode} value="amount" />
            上書き（この金額にする）
          </label>
          <label class="radio-option">
            <input type="radio" bind:group={balanceMode} value="delta" />
            増減（この金額を加算、マイナスで減算）
          </label>
        </div>
        <div class="field">
          <label for="balanceInput">金額</label>
          <input id="balanceInput" type="number" inputmode="numeric" bind:value={balanceInput} required disabled={balanceSubmitting} />
        </div>
        {#if balanceSubmitError}
          <p class="alert alert-error" role="alert">{balanceSubmitError}</p>
        {/if}
        <button class="btn btn-primary" type="submit" disabled={balanceSubmitting}>
          {balanceSubmitting ? "更新中…" : "更新する"}
        </button>
      </form>
    </section>

    <section class="card">
      <h2>購入登録</h2>

      <div class="receipt-upload">
        <div class="field">
          <span class="field-label">レシート写真（任意・AIが金額と品目を読み取ります）</span>
          <input
            bind:this={newCameraFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            class="hidden-file-input"
            onchange={handleNewReceiptFileChange}
            disabled={newAnalyzing}
          />
          <input
            bind:this={newGalleryFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            class="hidden-file-input"
            onchange={handleNewReceiptFileChange}
            disabled={newAnalyzing}
          />
          <div class="receipt-source-buttons">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick={() => newCameraFileInputRef?.click()}
              disabled={newAnalyzing}
            >
              カメラで撮影
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick={() => newGalleryFileInputRef?.click()}
              disabled={newAnalyzing}
            >
              ギャラリーから選択
            </button>
          </div>
          {#if newReceiptFile}
            <p class="selected-file">選択中の画像: {newReceiptFile.name}</p>
          {/if}
        </div>
        {#if newReceiptFile}
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            onclick={handleNewAnalyzeReceipt}
            disabled={newAnalyzing || !!newReceiptImagePath}
          >
            {newAnalyzing ? "解析中…" : newReceiptImagePath ? "解析済み" : "この画像を解析する"}
          </button>
        {/if}
        {#if newAnalyzeError}
          <p class="alert alert-error" role="alert">{newAnalyzeError}</p>
        {/if}
        {#if newAnalyzeResult}
          <p class="alert alert-success">解析結果を金額・メモ欄に反映しました。内容を確認・修正してから登録してください。</p>
        {/if}
      </div>

      <form onsubmit={handleNewPurchaseSubmit}>
        <div class="field">
          <label for="newAmount">金額</label>
          <input id="newAmount" type="number" inputmode="numeric" bind:value={newAmount} required disabled={newSubmitting} />
        </div>
        <div class="field">
          <label for="newStoreName">購入店舗（任意）</label>
          <input id="newStoreName" type="text" bind:value={newStoreName} disabled={newSubmitting} />
        </div>
        <div class="field">
          <label for="newMemo">品目メモ（任意）</label>
          <input id="newMemo" type="text" bind:value={newMemo} disabled={newSubmitting} />
        </div>
        <div class="field">
          <label for="newPurchasedAt">購入日</label>
          <input id="newPurchasedAt" type="date" bind:value={newPurchasedAt} required disabled={newSubmitting} />
        </div>
        {#if newSubmitError}
          <p class="alert alert-error" role="alert">{newSubmitError}</p>
        {/if}
        <button class="btn btn-primary" type="submit" disabled={newSubmitting}>
          {newSubmitting ? "登録中…" : "登録する"}
        </button>
      </form>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>購入履歴の編集・削除（直近{HISTORY_PREVIEW_COUNT}件）</h2>
        <a class="link" href="/admin/dashboard/history">月別に見る →</a>
      </div>
      {#if historyError}
        <p class="alert alert-error" role="alert">{historyError}</p>
      {/if}
      {#if syncError}
        <p class="alert alert-error" role="alert">{syncError}</p>
      {/if}
      {#if purchases.length === 0 && !historyLoading}
        <p class="text-muted">購入履歴はありません</p>
      {:else}
        <ul class="purchase-list">
          {#each purchases as purchase (purchase.id)}
            <li>
              {#if editingId === purchase.id}
                <div class="edit-form">
                  <div class="field">
                    <label for={`edit-amount-${purchase.id}`}>金額</label>
                    <input id={`edit-amount-${purchase.id}`} type="number" inputmode="numeric" bind:value={editAmount} disabled={editSubmitting} />
                  </div>
                  <div class="field">
                    <label for={`edit-store-${purchase.id}`}>購入店舗</label>
                    <input id={`edit-store-${purchase.id}`} type="text" bind:value={editStoreName} disabled={editSubmitting} />
                  </div>
                  <div class="field">
                    <label for={`edit-memo-${purchase.id}`}>メモ</label>
                    <input id={`edit-memo-${purchase.id}`} type="text" bind:value={editMemo} disabled={editSubmitting} />
                  </div>
                  <div class="field">
                    <label for={`edit-purchasedAt-${purchase.id}`}>購入日</label>
                    <input
                      id={`edit-purchasedAt-${purchase.id}`}
                      type="date"
                      bind:value={editPurchasedAt}
                      disabled={editSubmitting}
                    />
                  </div>
                  {#if editError}
                    <p class="alert alert-error" role="alert">{editError}</p>
                  {/if}
                  <div class="edit-actions">
                    <button class="btn btn-primary btn-sm" onclick={() => submitEdit(purchase.id)} disabled={editSubmitting}>
                      {editSubmitting ? "保存中…" : "保存"}
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick={cancelEdit} disabled={editSubmitting}>
                      キャンセル
                    </button>
                  </div>
                </div>
              {:else}
                <div class="purchase-row">
                  <span class="purchase-amount">{purchase.amount.toLocaleString()}円</span>
                  {#if purchase.storeName}
                    <span class="purchase-store">{purchase.storeName}</span>
                  {/if}
                  <span class="purchase-memo">{purchase.memo ?? ""}</span>
                  <span class="purchase-date">{formatDate(purchase.purchasedAt)}</span>
                  {#if purchase.editedByAdmin}
                    <span class="badge badge-warning">編集済み</span>
                  {/if}
                  {#if purchase.notionSyncStatus === "failed"}
                    <span class="badge badge-danger" title={purchase.notionSyncError ?? ""}>Notion送信失敗</span>
                  {:else if purchase.notionSyncStatus === "synced"}
                    <span class="badge badge-success">Notion送信済み</span>
                  {/if}
                </div>
                <div class="purchase-actions">
                  <button class="btn btn-secondary btn-sm" onclick={() => startEdit(purchase)}>編集</button>
                  {#if purchase.notionSyncStatus === "failed"}
                    <button
                      class="btn btn-secondary btn-sm"
                      onclick={() => retryNotionSync(purchase.id)}
                      disabled={syncingId === purchase.id}
                    >
                      {syncingId === purchase.id ? "送信中…" : "Notionに再送信"}
                    </button>
                  {/if}
                  <button class="btn btn-danger btn-sm" onclick={() => handleDelete(purchase.id)} disabled={deletingId === purchase.id}>
                    {deletingId === purchase.id ? "削除中…" : "削除"}
                  </button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>

  {#if newPendingCropFile}
    <ReceiptImageCropper file={newPendingCropFile} onCaptured={handleNewCropConfirmed} onClose={handleNewCropCancelled} />
  {/if}
</div>

<style>
  .header-title {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .balance-card {
    align-items: flex-start;
  }

  .balance-figure {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .unit {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-ink-muted);
  }

  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .link {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-accent);
    text-decoration: none;
    white-space: nowrap;
  }

  .link:hover {
    text-decoration: underline;
  }

  .receipt-upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding-bottom: var(--space-md);
    border-bottom: 1px dashed var(--color-border);
  }

  .field-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-ink-muted);
  }

  .hidden-file-input {
    display: none;
  }

  .receipt-source-buttons {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .selected-file {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-ink-muted);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: 0.9375rem;
  }

  .radio-option input {
    accent-color: var(--color-accent);
  }

  .purchase-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .purchase-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-sm);
    padding: var(--space-sm) 0;
    border-bottom: 1px solid var(--color-border);
  }

  .purchase-list li:last-child {
    border-bottom: none;
  }

  .purchase-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem var(--space-md);
  }

  .purchase-amount {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    min-width: 5.5rem;
  }

  .purchase-store {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-accent);
  }

  .purchase-memo {
    color: var(--color-ink-muted);
    font-size: 0.9375rem;
  }

  .purchase-date {
    color: var(--color-ink-faint);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .purchase-actions {
    display: flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    width: 100%;
    padding: var(--space-sm) 0;
  }

  .edit-actions {
    display: flex;
    gap: var(--space-xs);
  }

  @media (max-width: 480px) {
    .purchase-list li {
      flex-direction: column;
      align-items: flex-start;
    }

    .purchase-actions {
      width: 100%;
    }

    .purchase-actions .btn {
      flex: 1;
    }
  }
</style>
