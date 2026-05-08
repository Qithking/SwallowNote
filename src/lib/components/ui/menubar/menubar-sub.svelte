<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let { ref = $bindable(null), ...restProps }: MenubarPrimitive.SubProps = $props();
</script>

<MenubarPrimitive.Sub bind:ref {...restProps} />
