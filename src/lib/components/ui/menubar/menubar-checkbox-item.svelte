<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		children,
		...restProps
	}: MenubarPrimitive.CheckboxItemProps & {
		children?: Snippet;
	} = $props();
</script>

<MenubarPrimitive.CheckboxItem
	bind:ref
	bind:checked
	data-slot="menubar-checkbox-item"
	class={className}
	{...restProps}
>
	<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
		<MenubarPrimitive.CheckboxItemIndicator>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
				<polyline points="20 6 9 17 4 12" />
			</svg>
		</MenubarPrimitive.CheckboxItemIndicator>
	</span>
	{@render children?.()}
</MenubarPrimitive.CheckboxItem>
