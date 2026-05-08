<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.GroupHeadingProps = $props();
</script>

<MenubarPrimitive.GroupHeading
	bind:ref
	data-slot="menubar-group-heading"
	class={cn("px-2 py-1.5 text-sm font-semibold text-muted-foreground", className)}
	{...restProps}
/>
