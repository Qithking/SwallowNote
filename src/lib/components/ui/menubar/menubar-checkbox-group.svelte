<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		value = $bindable([]),
		...restProps
	}: MenubarPrimitive.CheckboxGroupProps = $props();
</script>

<MenubarPrimitive.CheckboxGroup
	bind:ref
	bind:value
	data-slot="menubar-checkbox-group"
	{...restProps}
/>
