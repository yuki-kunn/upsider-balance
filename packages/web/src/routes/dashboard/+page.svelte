<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance, PurchaseListItem, AnalyzeReceiptResponse } from "@upsider-balance/shared";
  import { apiGet, apiPost } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { uploadReceiptImage } from "$lib/receipt-upload";
  import { millisToDateInput, dateInputToMillis, formatDate } from "$lib/date-format";
  import ReceiptImageCropper from "$lib/ReceiptImageCropper.svelte";

  const HISTORY_PREVIEW_COUNT = 3;

  let balance = $state<Balance | null>(null);
  let balanceError = $state("");

  let amount = $state("");
  let storeName = $state("");
  let memo = $state("");
  let purchasedAt = $state(millisToDateInput(Date.now()));
  let submitting = $state(false);
  let submitError = $state("");

  let receiptFile = $state<File | null>(null);
  let receiptFileInputRef = $state<HTMLInputElement | null>(null);
  let receiptImagePath = $state<string | null>(null);
  let analyzing = $state(false);
  let analyzeError = $state("");
  let analyzeResult = $state<AnalyzeReceiptResponse | null>(null);
  /** ファイル選択直後、切り抜き調整のため一時的に保持する画像。ここに値がある間だけトリミングモーダルを開く */
  let pendingCropFile = $state<File | null>(null);

  let purchases = $state<PurchaseListItem[]>([]);
  let historyLoading = $state(false);
  let historyError = $state("");

  async function loadBalance() {
    try {
      const res = await apiGet<{ facilityId: string; balance: Balance }>("/balance");
      balance = res.balance;
      balanceError = "";
    } catch {
      balanceError = "残額の取得に失敗しました";
    }
  }

  /** ダッシュボードでは直近件のみプレビュー表示する。全履歴は月別履歴ページで確認する */
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
    await goto("/");
  }

  async function handlePurchaseSubmit(event: SubmitEvent) {
    event.preventDefault();
    submitError = "";

    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || !Number.isInteger(amountValue)) {
      submitError = "金額は整数で入力してください";
      return;
    }
    const purchasedAtMillis = dateInputToMillis(purchasedAt, Date.now());
    if (purchasedAtMillis === null) {
      submitError = "購入日を正しく入力してください";
      return;
    }

    submitting = true;
    try {
      await apiPost("/purchases", {
        amount: amountValue,
        storeName: storeName.trim().length > 0 ? storeName.trim() : null,
        memo: memo.trim().length > 0 ? memo.trim() : null,
        purchasedAt: purchasedAtMillis,
        receiptImagePath,
        receiptOcrRaw: analyzeResult?.raw ?? null,
      });
      amount = "";
      storeName = "";
      memo = "";
      purchasedAt = millisToDateInput(Date.now());
      receiptFile = null;
      if (receiptFileInputRef) receiptFileInputRef.value = "";
      receiptImagePath = null;
      analyzeResult = null;
      await Promise.all([loadBalance(), loadPurchases()]);
    } catch {
      submitError = "購入登録に失敗しました";
    } finally {
      submitting = false;
    }
  }

  /** ファイル選択（カメラ撮影・ギャラリー選択いずれも）直後に切り抜き調整モーダルを挟む */
  function handleReceiptFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // 同じファイルを選び直した場合もchangeイベントが発火するようにリセットしておく
    input.value = "";
    if (!file) return;
    pendingCropFile = file;
  }

  /** 切り抜き確定後の画像を受け取り、以降は既存のフローと同じ扱いにする */
  function handleCropConfirmed(file: File) {
    receiptFile = file;
    analyzeError = "";
    analyzeResult = null;
    receiptImagePath = null;
    pendingCropFile = null;
  }

  function handleCropCancelled() {
    pendingCropFile = null;
  }

  async function handleAnalyzeReceipt() {
    if (!receiptFile) return;
    analyzeError = "";
    analyzing = true;
    try {
      const path = await uploadReceiptImage(receiptFile);
      receiptImagePath = path;
      const result = await apiPost<AnalyzeReceiptResponse>("/receipts/analyze", {
        receiptImagePath: path,
      });
      analyzeResult = result;
      // 解析結果はプリフィルのみ行い、スタッフが確認・修正してから登録する（自動登録はしない）
      if (result.amountCandidates.length > 0) {
        amount = String(result.amountCandidates[0]);
      }
      if (result.storeNameCandidates.length > 0) {
        storeName = result.storeNameCandidates[0];
      }
      if (result.itemCandidates.length > 0) {
        memo = result.itemCandidates.join(" ");
      }
    } catch (e) {
      analyzeError = e instanceof Error ? e.message : "レシート画像の解析に失敗しました";
    } finally {
      analyzing = false;
    }
  }

</script>

<div class="page">
  <header class="page-header">
    <h1>残額ダッシュボード</h1>
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
        {#if balance.amount < 0}
          <p class="alert alert-error" role="alert">残額がマイナスです</p>
        {/if}
      {/if}
    </section>

    <section class="card">
      <h2>購入登録</h2>

      <div class="receipt-upload">
        <div class="field">
          <label for="receiptFile">レシート写真（任意・AIが金額と品目を読み取ります）</label>
          <input
            bind:this={receiptFileInputRef}
            id="receiptFile"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onchange={handleReceiptFileChange}
            disabled={analyzing}
          />
          {#if receiptFile}
            <!-- 切り抜き後のFileはinput要素のvalueに反映できない（ブラウザの仕様）ため、
                 実際に選択されているファイルを別途テキストで表示する -->
            <p class="selected-file">選択中の画像: {receiptFile.name}</p>
          {/if}
        </div>
        {#if receiptFile}
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            onclick={handleAnalyzeReceipt}
            disabled={analyzing || !!receiptImagePath}
          >
            {analyzing ? "解析中…" : receiptImagePath ? "解析済み" : "この画像を解析する"}
          </button>
        {/if}
        {#if analyzeError}
          <p class="alert alert-error" role="alert">{analyzeError}</p>
        {/if}
        {#if analyzeResult}
          <p class="alert alert-success">解析結果を金額・メモ欄に反映しました。内容を確認・修正してから登録してください。</p>
        {/if}
      </div>

      <form onsubmit={handlePurchaseSubmit}>
        <div class="field">
          <label for="amount">金額</label>
          <input id="amount" type="number" inputmode="numeric" bind:value={amount} required disabled={submitting} />
        </div>
        <div class="field">
          <label for="storeName">購入店舗（任意）</label>
          <input id="storeName" type="text" bind:value={storeName} disabled={submitting} />
        </div>
        <div class="field">
          <label for="memo">品目メモ（任意）</label>
          <input id="memo" type="text" bind:value={memo} disabled={submitting} />
        </div>
        <div class="field">
          <label for="purchasedAt">購入日</label>
          <input id="purchasedAt" type="date" bind:value={purchasedAt} required disabled={submitting} />
        </div>
        {#if submitError}
          <p class="alert alert-error" role="alert">{submitError}</p>
        {/if}
        <button class="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "登録中…" : "登録する"}
        </button>
      </form>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>購入履歴（直近{HISTORY_PREVIEW_COUNT}件）</h2>
        <a class="link" href="/dashboard/history">月別に見る →</a>
      </div>
      {#if historyError}
        <p class="alert alert-error" role="alert">{historyError}</p>
      {/if}
      {#if purchases.length === 0 && !historyLoading}
        <p class="text-muted">購入履歴はありません</p>
      {:else}
        <ul class="purchase-list">
          {#each purchases as purchase (purchase.id)}
            <li>
              <span class="purchase-amount">{purchase.amount.toLocaleString()}円</span>
              {#if purchase.storeName}
                <span class="purchase-store">{purchase.storeName}</span>
              {/if}
              <span class="purchase-memo">{purchase.memo ?? ""}</span>
              <span class="purchase-date">{formatDate(purchase.purchasedAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>

  {#if pendingCropFile}
    <ReceiptImageCropper file={pendingCropFile} onCaptured={handleCropConfirmed} onClose={handleCropCancelled} />
  {/if}
</div>

<style>
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

  .receipt-upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding-bottom: var(--space-md);
    border-bottom: 1px dashed var(--color-border);
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

  .purchase-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .purchase-list li {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem var(--space-md);
    padding: var(--space-sm) 0;
    border-bottom: 1px solid var(--color-border);
  }

  .purchase-list li:last-child {
    border-bottom: none;
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
    flex: 1;
    min-width: 8rem;
    color: var(--color-ink-muted);
    font-size: 0.9375rem;
  }

  .purchase-date {
    color: var(--color-ink-faint);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 480px) {
    .purchase-list li {
      flex-direction: column;
      gap: 0.15rem;
    }
  }
</style>
