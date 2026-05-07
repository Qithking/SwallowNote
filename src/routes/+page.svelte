<script lang="ts">
  import { onMount } from 'svelte';
  import AppLayout from '$lib/components/Layout/AppLayout.svelte';
  import { theme } from '$lib/stores/theme';
  import '../app.css';

  onMount(() => {
    theme.init();
  });
</script>

<AppLayout />
