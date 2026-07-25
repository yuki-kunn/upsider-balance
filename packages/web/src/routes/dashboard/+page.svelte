<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance, PurchaseListItem, AnalyzeReceiptResponse } from "@upsider-balance/shared";
  import { apiGet, apiPost } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { uploadReceiptImage } from "$lib/receipt-upload";

  let balance = $state<Balance | null>(null);
  let balanceError = $state("");

  let amount = $state("");
  let memo = $state("");
  let submitting = $state(false);
  let submitError = $state("");

  let receiptFile = $state<File | null>(null);
  let receiptImagePath = $state<string | null>(null);
  let analyzing = $state(false);
  let analyzeError = $state("");
  let analyzeResult = $state<AnalyzeReceiptResponse | null>(null);

  let purchases = $state<PurchaseListItem[]>([]);
  let nextCursor = $state<string | null>(null);
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

  async function loadPurchases(reset = true) {
    historyLoading = true;
    historyError = "";
    try {
      const query = !reset && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const res = await apiGet<{ purchases: PurchaseListItem[]; nextCursor: string | null }>(`/purchases${query}`);
      purchases = reset ? res.purchases : [...purchases, ...res.purchases];
      nextCursor = res.nextCursor;
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

    submitting = true;
    try {
      await apiPost("/purchases", {
        amount: amountValue,
        memo: memo.trim().length > 0 ? memo.trim() : null,
        receiptImagePath,
        receiptOcrRaw: analyzeResult?.raw ?? null,
      });
      amount = "";
      memo = "";
      receiptFile = null;
      receiptImagePath = null;
      analyzeResult = null;
      await Promise.all([loadBalance(), loadPurchases()]);
    } catch {
      submitError = "購入登録に失敗しました";
    } finally {
      submitting = false;
    }
  }

  function handleReceiptFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    receiptFile = input.files?.[0] ?? null;
    analyzeError = "";
    analyzeResult = null;
    receiptImagePath = null;
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
      const memoParts = [...result.storeNameCandidates, ...result.itemCandidates];
      if (memoParts.length > 0) {
        memo = memoParts.join(" ");
      }
    } catch (e) {
      analyzeError = e instanceof Error ? e.message : "レシート画像の解析に失敗しました";
    } finally {
      analyzing = false;
    }
  }

  function formatDateTime(millis: number): string {
    return new Date(millis).toLocaleString("ja-JP");
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
            id="receiptFile"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onchange={handleReceiptFileChange}
            disabled={analyzing}
          />
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
          <label for="memo">品目メモ（任意）</label>
          <input id="memo" type="text" bind:value={memo} disabled={submitting} />
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
      <h2>購入履歴</h2>
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
              <span class="purchase-memo">{purchase.memo ?? ""}</span>
              <span class="purchase-date">{formatDateTime(purchase.purchasedAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if nextCursor}
        <button class="btn btn-secondary btn-sm" onclick={() => loadPurchases(false)} disabled={historyLoading}>
          {historyLoading ? "読み込み中…" : "もっと見る"}
        </button>
      {/if}
    </section>
  </main>
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

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
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
