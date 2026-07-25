<script lang="ts">
  import { goto } from "$app/navigation";
  import { loginAsAdmin } from "$lib/auth";

  let adminId = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    try {
      await loginAsAdmin(adminId, password);
      await goto("/admin/dashboard");
    } catch (e) {
      error = "admin IDまたはPASSが正しくありません";
    } finally {
      loading = false;
    }
  }
</script>

<main class="login-page">
  <div class="login-card">
    <p class="eyebrow">UPSIDER残額共有 · 管理者</p>
    <h1>admin ログイン</h1>
    <form onsubmit={handleSubmit}>
      <div class="field">
        <label for="adminId">admin ID</label>
        <input id="adminId" type="text" bind:value={adminId} required autocomplete="username" disabled={loading} />
      </div>
      <div class="field">
        <label for="password">PASS</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          autocomplete="current-password"
          disabled={loading}
        />
      </div>
      {#if error}
        <p class="alert alert-error" role="alert">{error}</p>
      {/if}
      <button class="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "ログイン中…" : "ログイン"}
      </button>
    </form>
    <a class="admin-link" href="/">施設用ログインはこちら</a>
  </div>
</main>

<style>
  .login-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-lg);
  }

  .login-card {
    width: 100%;
    max-width: 360px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: var(--space-xl) var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .eyebrow {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  h1 {
    font-size: 1.375rem;
    margin-bottom: var(--space-xs);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  form .btn {
    margin-top: var(--space-2xs);
  }

  .admin-link {
    align-self: center;
    font-size: 0.8125rem;
    color: var(--color-ink-muted);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }

  .admin-link:hover {
    color: var(--color-accent);
    border-bottom-color: currentColor;
  }
</style>
