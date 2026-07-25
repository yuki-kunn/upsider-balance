<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance, PurchaseListItem } from "@upsider-balance/shared";
  import { apiGet, apiPatch, apiDelete } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";

  let balance = $state<Balance | null>(null);
  let balanceError = $state("");

  let balanceMode = $state<"amount" | "delta">("amount");
  let balanceInput = $state("");
  let balanceSubmitting = $state(false);
  let balanceSubmitError = $state("");

  let purchases = $state<PurchaseListItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let historyLoading = $state(false);
  let historyError = $state("");

  let editingId = $state<string | null>(null);
  let editAmount = $state("");
  let editMemo = $state("");
  let editSubmitting = $state(false);
  let editError = $state("");

  let deletingId = $state<string | null>(null);

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

  function startEdit(purchase: PurchaseListItem) {
    editingId = purchase.id;
    editAmount = String(purchase.amount);
    editMemo = purchase.memo ?? "";
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

    editSubmitting = true;
    try {
      await apiPatch(`/admin/purchases/${id}`, {
        amount: amountValue,
        memo: editMemo.trim().length > 0 ? editMemo.trim() : null,
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

  function formatDateTime(millis: number): string {
    return new Date(millis).toLocaleString("ja-JP");
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
      <h2>購入履歴の編集・削除</h2>
      {#if historyError}
        <p class="alert alert-error" role="alert">{historyError}</p>
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
                    <label for={`edit-memo-${purchase.id}`}>メモ</label>
                    <input id={`edit-memo-${purchase.id}`} type="text" bind:value={editMemo} disabled={editSubmitting} />
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
                  <span class="purchase-memo">{purchase.memo ?? ""}</span>
                  <span class="purchase-date">{formatDateTime(purchase.purchasedAt)}</span>
                  {#if purchase.editedByAdmin}
                    <span class="badge badge-warning">編集済み</span>
                  {/if}
                </div>
                <div class="purchase-actions">
                  <button class="btn btn-secondary btn-sm" onclick={() => startEdit(purchase)}>編集</button>
                  <button class="btn btn-danger btn-sm" onclick={() => handleDelete(purchase.id)} disabled={deletingId === purchase.id}>
                    {deletingId === purchase.id ? "削除中…" : "削除"}
                  </button>
                </div>
              {/if}
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
