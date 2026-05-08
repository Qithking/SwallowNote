<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let { ref = $bindable(null), ...restProps }: MenubarPrimitive.MenuProps = $props();
</script>

<MenubarPrimitive.Menu bind:ref {...restProps} />
