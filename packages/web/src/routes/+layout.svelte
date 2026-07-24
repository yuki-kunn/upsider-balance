<script lang="ts">
  import { currentUser } from "$lib/auth";

  let { children } = $props();
</script>

<!-- currentUserをsubscribeしておくことで認証状態の変化をアプリ全体に反映する -->
{#if $currentUser !== undefined}
  {@render children()}
{:else}
  <p>読み込み中...</p>
{/if}
