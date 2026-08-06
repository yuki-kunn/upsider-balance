<script lang="ts">
  import { onMount } from "svelte";
  import type { PurchaseListItem } from "@upsider-balance/shared";
  import { apiGet, apiPatch, apiPost, apiDelete } from "$lib/api-client";
  import { millisToDateInput, dateInputToMillis, formatDate, formatMonthLabel } from "$lib/date-format";

  const now = new Date();
  let year = $state(now.getFullYear());
  let month = $state(now.getMonth() + 1);

  let purchases = $state<PurchaseListItem[]>([]);
  let loading = $state(false);
  let error = $state("");

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
      // 購入日時を月をまたいで変更した場合、この月の一覧から消えることがある
      await loadMonth();
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
      await loadMonth();
    } catch {
      error = "購入履歴の削除に失敗しました";
    } finally {
      deletingId = null;
    }
  }

  async function retryNotionSync(id: string) {
    syncError = "";
    syncingId = id;
    try {
      await apiPost(`/admin/purchases/${id}/notion-sync`, {});
      await loadMonth();
    } catch {
      syncError = "Notionへの再送信に失敗しました";
    } finally {
      syncingId = null;
    }
  }

  onMount(() => {
    loadMonth();
  });
</script>

<div class="page">
  <header class="page-header">
    <div class="header-title">
      <h1>月別購入履歴</h1>
      <span class="badge badge-warning">管理者</span>
    </div>
    <a class="btn btn-secondary btn-sm" href="/admin/dashboard">ダッシュボードに戻る</a>
  </header>

  <main class="page-body">
    <section class="card">
      <div class="month-nav">
        <button class="btn btn-secondary btn-sm" onclick={goToPreviousMonth} disabled={loading}>← 前月</button>
        <h2 class="month-label">{formatMonthLabel(year, month)}</h2>
        <button class="btn btn-secondary btn-sm" onclick={goToNextMonth} disabled={loading}>次月 →</button>
      </div>

      {#if syncError}
        <p class="alert alert-error" role="alert">{syncError}</p>
      {/if}
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
                {#if editingId === purchase.id}
                  <div class="edit-form">
                    <div class="field">
                      <label for={`edit-amount-${purchase.id}`}>金額</label>
                      <input
                        id={`edit-amount-${purchase.id}`}
                        type="number"
                        inputmode="numeric"
                        bind:value={editAmount}
                        disabled={editSubmitting}
                      />
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
                    <button
                      class="btn btn-danger btn-sm"
                      onclick={() => handleDelete(purchase.id)}
                      disabled={deletingId === purchase.id}
                    >
                      {deletingId === purchase.id ? "削除中…" : "削除"}
                    </button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </main>
</div>

<style>
  .header-title {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

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
