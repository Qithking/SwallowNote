<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.LabelProps = $props();
</script>

<MenubarPrimitive.Label
	bind:ref
	data-slot="menubar-label"
	class={cn("px-2 py-1.5 text-sm font-semibold", className)}
	{...restProps}
/>
