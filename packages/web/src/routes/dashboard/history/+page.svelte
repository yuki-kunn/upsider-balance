<script lang="ts">
  import { onMount } from "svelte";
  import type { PurchaseListItem } from "@upsider-balance/shared";
  import { apiGet } from "$lib/api-client";
  import { formatDateTime, formatMonthLabel } from "$lib/date-format";

  const now = new Date();
  let year = $state(now.getFullYear());
  let month = $state(now.getMonth() + 1);

  let purchases = $state<PurchaseListItem[]>([]);
  let loading = $state(false);
  let error = $state("");

  const totalAmount = $derived(purchases.reduce((sum, p) => sum + p.amount, 0));

  async function loadMonth() {
    loading = true;
    error = "";
    try {
      const res = await apiGet<{ purchases: PurchaseListItem[] }>(`/purchases?year=${year}&month=${month}`);
      purchases = res.purchases;
    } catch {
      error = "購入履歴の取得に失敗しました";
    } finally {
      loading = false;
    }
  }

  function goToPreviousMonth() {
    if (month === 1) {
      year -= 1;
      month = 12;
    } else {
      month -= 1;
    }
    loadMonth();
  }

  function goToNextMonth() {
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    loadMonth();
  }

  onMount(() => {
    loadMonth();
  });
</script>

<div class="page">
  <header class="page-header">
    <h1>月別購入履歴</h1>
    <a class="btn btn-secondary btn-sm" href="/dashboard">ダッシュボードに戻る</a>
  </header>

  <main class="page-body">
    <section class="card">
      <div class="month-nav">
        <button class="btn btn-secondary btn-sm" onclick={goToPreviousMonth} disabled={loading}>← 前月</button>
        <h2 class="month-label">{formatMonthLabel(year, month)}</h2>
        <button class="btn btn-secondary btn-sm" onclick={goToNextMonth} disabled={loading}>次月 →</button>
      </div>

      {#if error}
        <p class="alert alert-error" role="alert">{error}</p>
      {:else if loading}
        <p class="text-muted">読み込み中…</p>
      {:else}
        <p class="month-total">
          この月の合計: <span class="total-figure">{totalAmount.toLocaleString()}円</span>（{purchases.length}件）
        </p>
        {#if purchases.length === 0}
          <p class="text-muted">この月の購入履歴はありません</p>
        {:else}
          <ul class="purchase-list">
            {#each purchases as purchase (purchase.id)}
              <li>
                <span class="purchase-amount">{purchase.amount.toLocaleString()}円</span>
                {#if purchase.storeName}
                  <span class="purchase-store">{purchase.storeName}</span>
                {/if}
                <span class="purchase-memo">{purchase.memo ?? ""}</span>
                <span class="purchase-date">{formatDateTime(purchase.purchasedAt)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </main>
</div>

<style>
  .month-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .month-label {
    font-size: 1.125rem;
    white-space: nowrap;
  }

  .month-total {
    font-size: 0.9375rem;
    color: var(--color-ink-muted);
  }

  .total-figure {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    color: var(--color-ink);
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
