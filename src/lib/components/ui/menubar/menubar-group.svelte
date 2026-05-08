<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.GroupProps = $props();
</script>

<MenubarPrimitive.Group
	bind:ref
	data-slot="menubar-group"
	class={cn("p-1", className)}
	{...restProps}
/>
