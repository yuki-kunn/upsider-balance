<script lang="ts">
  import { onMount } from "svelte";
  import type { Balance } from "@upsider-balance/shared";
  import { apiGet } from "$lib/api-client";
  import { logout } from "$lib/auth";
  import { goto } from "$app/navigation";

  let balance = $state<Balance | null>(null);
  let error = $state("");
  let amount = $state("");
  let memo = $state("");

  onMount(async () => {
    try {
      balance = await apiGet<Balance>("/balance");
    } catch (e) {
      error = "残額の取得に失敗しました";
    }
  });

  async function handleLogout() {
    await logout();
    await goto("/");
  }

  function handlePurchaseSubmit(event: SubmitEvent) {
    event.preventDefault();
    // TODO: POST /api/purchases を呼び出す実装
  }
</script>

<main>
  <header>
    <h1>残額ダッシュボード</h1>
    <button onclick={handleLogout}>ログアウト</button>
  </header>

  <section>
    <h2>現在残額</h2>
    {#if error}
      <p role="alert">{error}</p>
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
    <form onsubmit={handlePurchaseSubmit}>
      <div>
        <label for="amount">金額</label>
        <input id="amount" type="number" bind:value={amount} required />
      </div>
      <div>
        <label for="memo">品目メモ（任意）</label>
        <input id="memo" type="text" bind:value={memo} />
      </div>
      <button type="submit">登録</button>
    </form>
  </section>

  <section>
    <h2>購入履歴</h2>
    <p>（履歴一覧は今後実装）</p>
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
</style>
