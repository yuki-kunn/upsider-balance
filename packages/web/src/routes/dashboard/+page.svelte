<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance, Purchase, AnalyzeReceiptResponse } from "@upsider-balance/shared";
  import { apiGet, apiPost } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { uploadReceiptImage, ReceiptUploadError } from "$lib/receipt-upload";

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

  let purchases = $state<Purchase[]>([]);
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
      const res = await apiGet<{ purchases: Purchase[]; nextCursor: string | null }>(`/purchases${query}`);
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
      analyzeError = e instanceof ReceiptUploadError ? e.message : "レシート画像の解析に失敗しました";
    } finally {
      analyzing = false;
    }
  }

  function formatDateTime(millis: number): string {
    return new Date(millis).toLocaleString("ja-JP");
  }
</script>

<main>
  <header>
    <h1>残額ダッシュボード</h1>
    <button onclick={handleLogout}>ログアウト</button>
  </header>

  <section>
    <h2>現在残額</h2>
    {#if balanceError}
      <p role="alert">{balanceError}</p>
    {:else if balance === null}
      <p>読み込み中...</p>
    {:else}
      <p class="balance" class:negative={balance.amount < 0}>{balance.amount.toLocaleString()}円</p>
      {#if balance.amount < 0}
        <p role="alert">残額がマイナスです</p>
      {/if}
    {/if}
  </section>

  <section>
    <h2>購入登録</h2>

    <div class="receipt-upload">
      <label for="receiptFile">レシート写真（任意、AIが金額・品目を読み取ります）</label>
      <input
        id="receiptFile"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        onchange={handleReceiptFileChange}
        disabled={analyzing}
      />
      {#if receiptFile}
        <button type="button" onclick={handleAnalyzeReceipt} disabled={analyzing || !!receiptImagePath}>
          {analyzing ? "解析中..." : receiptImagePath ? "解析済み" : "この画像を解析する"}
        </button>
      {/if}
      {#if analyzeError}
        <p role="alert">{analyzeError}</p>
      {/if}
      {#if analyzeResult}
        <p class="analyze-hint">解析結果を金額・メモ欄に反映しました。内容を確認・修正してから登録してください。</p>
      {/if}
    </div>

    <form onsubmit={handlePurchaseSubmit}>
      <div>
        <label for="amount">金額</label>
        <input id="amount" type="number" bind:value={amount} required disabled={submitting} />
      </div>
      <div>
        <label for="memo">品目メモ（任意）</label>
        <input id="memo" type="text" bind:value={memo} disabled={submitting} />
      </div>
      {#if submitError}
        <p role="alert">{submitError}</p>
      {/if}
      <button type="submit" disabled={submitting}>{submitting ? "登録中..." : "登録"}</button>
    </form>
  </section>

  <section>
    <h2>購入履歴</h2>
    {#if historyError}
      <p role="alert">{historyError}</p>
    {/if}
    {#if purchases.length === 0 && !historyLoading}
      <p>購入履歴はありません</p>
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
      <button onclick={() => loadPurchases(false)} disabled={historyLoading}>
        {historyLoading ? "読み込み中..." : "もっと見る"}
      </button>
    {/if}
  </section>
</main>

<style>
  .balance {
    font-size: 2.5rem;
    font-weight: bold;
  }
  .balance.negative {
    color: #c0392b;
  }
  .purchase-list {
    list-style: none;
    padding: 0;
  }
  .purchase-list li {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #ddd;
  }
  .purchase-amount {
    font-weight: bold;
    min-width: 6rem;
  }
  .purchase-memo {
    flex: 1;
    color: #555;
  }
  .purchase-date {
    color: #888;
    font-size: 0.85rem;
  }
  .receipt-upload {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px dashed #ccc;
  }
  .analyze-hint {
    color: #2e7d32;
    font-size: 0.85rem;
  }
</style>
