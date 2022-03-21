import { html, slotted } from "@microsoft/fast-element";
import { ListboxElement } from "./listbox.element";
/**
 * The template for the {@link @microsoft/fast-foundation#(Listbox:class)} component.
 * @public
 */
export const listboxTemplate = (context, definition) => html `
    <template
        aria-activedescendant="${x => x.ariaActiveDescendant}"
        aria-multiselectable="${x => x.ariaMultiSelectable}"
        class="listbox"
        role="listbox"
        tabindex="${x => (!x.disabled ? "0" : null)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        @focusin="${(x, c) => x.focusinHandler(c.event)}"
        @keydown="${(x, c) => x.keydownHandler(c.event)}"
        @mousedown="${(x, c) => x.mousedownHandler(c.event)}"
    >
        <slot
            ${slotted({
    filter: ListboxElement.slottedOptionFilter,
    flatten: true,
    property: "slottedOptions",
})}
        ></slot>
    </template>
`;
