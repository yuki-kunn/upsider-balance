<script lang="ts">
  import { goto } from "$app/navigation";
  import { loginAsFacility } from "$lib/auth";

  let facilityId = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    try {
      await loginAsFacility(facilityId, password);
      await goto("/dashboard");
    } catch (e) {
      error = "施設IDまたはPASSが正しくありません";
    } finally {
      loading = false;
    }
  }
</script>

<main>
  <h1>UPSIDER残額共有アプリ</h1>
  <form onsubmit={handleSubmit}>
    <div>
      <label for="facilityId">施設ID</label>
      <input id="facilityId" type="text" bind:value={facilityId} required autocomplete="username" />
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
  <p><a href="/admin">admin用ログインはこちら</a></p>
</main>
