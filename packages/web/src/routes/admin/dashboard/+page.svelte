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

<main>
  <header>
    <h1>admin管理画面</h1>
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
    {/if}
  </section>

  <section>
    <h2>残額の編集</h2>
    <form onsubmit={handleBalanceSubmit}>
      <div>
        <label>
          <input type="radio" bind:group={balanceMode} value="amount" />
          上書き（この金額にする）
        </label>
        <label>
          <input type="radio" bind:group={balanceMode} value="delta" />
          増減（この金額を加算、マイナスで減算）
        </label>
      </div>
      <div>
        <label for="balanceInput">金額</label>
        <input id="balanceInput" type="number" bind:value={balanceInput} required disabled={balanceSubmitting} />
      </div>
      {#if balanceSubmitError}
        <p role="alert">{balanceSubmitError}</p>
      {/if}
      <button type="submit" disabled={balanceSubmitting}>{balanceSubmitting ? "更新中..." : "更新"}</button>
    </form>
  </section>

  <section>
    <h2>購入履歴の編集・削除</h2>
    {#if historyError}
      <p role="alert">{historyError}</p>
    {/if}
    {#if purchases.length === 0 && !historyLoading}
      <p>購入履歴はありません</p>
    {:else}
      <ul class="purchase-list">
        {#each purchases as purchase (purchase.id)}
          <li>
            {#if editingId === purchase.id}
              <div class="edit-form">
                <label>
                  金額
                  <input type="number" bind:value={editAmount} disabled={editSubmitting} />
                </label>
                <label>
                  メモ
                  <input type="text" bind:value={editMemo} disabled={editSubmitting} />
                </label>
                {#if editError}
                  <p role="alert">{editError}</p>
                {/if}
                <button onclick={() => submitEdit(purchase.id)} disabled={editSubmitting}>
                  {editSubmitting ? "保存中..." : "保存"}
                </button>
                <button onclick={cancelEdit} disabled={editSubmitting}>キャンセル</button>
              </div>
            {:else}
              <span class="purchase-amount">{purchase.amount.toLocaleString()}円</span>
              <span class="purchase-memo">{purchase.memo ?? ""}</span>
              <span class="purchase-date">{formatDateTime(purchase.purchasedAt)}</span>
              {#if purchase.editedByAdmin}
                <span class="edited-badge">編集済み</span>
              {/if}
              <button onclick={() => startEdit(purchase)}>編集</button>
              <button onclick={() => handleDelete(purchase.id)} disabled={deletingId === purchase.id}>
                {deletingId === purchase.id ? "削除中..." : "削除"}
              </button>
            {/if}
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
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #ddd;
    flex-wrap: wrap;
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
  .edited-badge {
    color: #856404;
    background: #fff3cd;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
  }
  .edit-form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
</style>
