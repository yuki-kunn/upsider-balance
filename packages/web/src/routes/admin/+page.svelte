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

<main>
  <h1>admin ログイン</h1>
  <form onsubmit={handleSubmit}>
    <div>
      <label for="adminId">admin ID</label>
      <input id="adminId" type="text" bind:value={adminId} required autocomplete="username" />
    </div>
    <div>
      <label for="password">PASS</label>
      <input id="password" type="password" bind:value={password} required autocomplete="current-password" />
    </div>
    {#if error}
      <p role="alert">{error}</p>
    {/if}
    <button type="submit" disabled={loading}>ログイン</button>
  </form>
</main>
