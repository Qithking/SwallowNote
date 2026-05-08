<script lang="ts">
	import MenubarPortal from "./menubar-portal.svelte";
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		sideOffset = 8,
		alignOffset = -4,
		align = "start",
		side = "bottom",
		portalProps,
		class: className,
		...restProps
	}: MenubarPrimitive.ContentProps & {
		portalProps?: ComponentProps<typeof MenubarPortal>;
	} = $props();
</script>

<MenubarPortal {...portalProps}>
	<MenubarPrimitive.Content
		bind:ref
		data-slot="menubar-content"
		{align}
		{alignOffset}
		{side}
		{sideOffset}
		class={className}
		{...restProps}
	/>
</MenubarPortal>
