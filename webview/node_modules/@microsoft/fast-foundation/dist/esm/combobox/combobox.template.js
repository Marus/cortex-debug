import { html, ref, slotted } from "@microsoft/fast-element";
import { Listbox } from "../listbox/listbox";
import { endSlotTemplate, startSlotTemplate } from "../patterns/start-end";
/**
 * The template for the {@link @microsoft/fast-foundation#(Combobox:class)} component.
 * @public
 */
export const comboboxTemplate = (context, definition) => html `
    <template
        aria-disabled="${x => x.ariaDisabled}"
        autocomplete="${x => x.autocomplete}"
        class="${x => (x.open ? "open" : "")} ${x => x.disabled ? "disabled" : ""} ${x => x.position}"
        ?open="${x => x.open}"
        tabindex="${x => (!x.disabled ? "0" : null)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        @focusout="${(x, c) => x.focusoutHandler(c.event)}"
        @keydown="${(x, c) => x.keydownHandler(c.event)}"
    >
        <div class="control" part="control">
            ${startSlotTemplate(context, definition)}
            <slot name="control">
                <input
                    aria-activedescendant="${x => x.open ? x.ariaActiveDescendant : null}"
                    aria-autocomplete="${x => x.ariaAutoComplete}"
                    aria-controls="${x => x.ariaControls}"
                    aria-disabled="${x => x.ariaDisabled}"
                    aria-expanded="${x => x.ariaExpanded}"
                    aria-haspopup="listbox"
                    class="selected-value"
                    part="selected-value"
                    placeholder="${x => x.placeholder}"
                    role="combobox"
                    type="text"
                    ?disabled="${x => x.disabled}"
                    :value="${x => x.value}"
                    @input="${(x, c) => x.inputHandler(c.event)}"
                    @keyup="${(x, c) => x.keyupHandler(c.event)}"
                    ${ref("control")}
                />
                <div class="indicator" part="indicator" aria-hidden="true">
                    <slot name="indicator">
                        ${definition.indicator || ""}
                    </slot>
                </div>
            </slot>
            ${endSlotTemplate(context, definition)}
        </div>
        <div
            class="listbox"
            id="${x => x.listboxId}"
            part="listbox"
            role="listbox"
            ?disabled="${x => x.disabled}"
            ?hidden="${x => !x.open}"
            ${ref("listbox")}
        >
            <slot
                ${slotted({
    filter: Listbox.slottedOptionFilter,
    flatten: true,
    property: "slottedOptions",
})}
            ></slot>
        </div>
    </template>
`;
