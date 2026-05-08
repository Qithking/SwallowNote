<script lang="ts">
	import { cn } from "$lib/utils/cn";
	import MenubarPortal from "./menubar-portal.svelte";
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = "start",
		portalProps,
		class: className,
		...restProps
	}: MenubarPrimitive.SubContentProps & {
		portalProps?: ComponentProps<typeof MenubarPortal>;
	} = $props();
</script>

<MenubarPortal {...portalProps}>
	<MenubarPrimitive.SubContent
		bind:ref
		data-slot="menubar-sub-content"
		{sideOffset}
		{align}
		class={cn(
			"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 bg-popover text-popover-foreground z-50 min-w-[8rem] rounded-md p-1 shadow-lg border border-border outline-none",
			className
		)}
		{...restProps}
	/>
</MenubarPortal>
