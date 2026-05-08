<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.ShortcutProps = $props();
</script>

<MenubarPrimitive.Shortcut
	bind:ref
	data-slot="menubar-shortcut"
	class={className}
	{...restProps}
/>
