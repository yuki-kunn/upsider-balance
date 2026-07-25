<script lang="ts">
  import "../app.css";
  import { currentUser } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  let { children } = $props();

  // 未ログイン状態でダッシュボード系ページに直接アクセスした場合はログイン画面へ戻す。
  // APIはHono側middlewareで401/403を返すため機能面の防御は既にあるが、
  // ここではUX改善（エラー表示のみで止まらないように）としてガードする（tech-debt issue #18）。
  $effect(() => {
    if ($currentUser === null) {
      const path = $page.url.pathname;
      if (path.startsWith("/admin/dashboard")) {
        goto("/admin");
      } else if (path.startsWith("/dashboard")) {
        goto("/");
      }
    }
  });
</script>

<!-- currentUserをsubscribeしておくことで認証状態の変化をアプリ全体に反映する -->
{#if $currentUser !== undefined}
  {@render children()}
{:else}
  <div class="loading-screen">読み込み中…</div>
{/if}
