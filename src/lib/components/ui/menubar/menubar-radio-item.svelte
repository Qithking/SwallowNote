<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		class: className,
		children,
		...restProps
	}: MenubarPrimitive.RadioItemProps & {
		children?: Snippet;
	} = $props();
</script>

<MenubarPrimitive.RadioItem
	bind:ref
	bind:value
	data-slot="menubar-radio-item"
	class={className}
	{...restProps}
>
	<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
		<MenubarPrimitive.RadioItemIndicator>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
				<circle cx="12" cy="12" r="10" />
			</svg>
		</MenubarPrimitive.RadioItemIndicator>
	</span>
	{@render children?.()}
</MenubarPrimitive.RadioItem>
