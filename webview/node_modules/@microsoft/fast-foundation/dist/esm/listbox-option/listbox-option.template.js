import { html } from "@microsoft/fast-element";
import { endSlotTemplate, startSlotTemplate } from "../patterns/start-end";
/**
 * The template for the {@link @microsoft/fast-foundation#(ListboxOption:class)} component.
 * @public
 */
export const listboxOptionTemplate = (context, definition) => html `
    <template
        aria-checked="${x => x.ariaChecked}"
        aria-disabled="${x => x.ariaDisabled}"
        aria-posinset="${x => x.ariaPosInSet}"
        aria-selected="${x => x.ariaSelected}"
        aria-setsize="${x => x.ariaSetSize}"
        class="${x => [x.checked && "checked", x.selected && "selected", x.disabled && "disabled"]
    .filter(Boolean)
    .join(" ")}"
        role="option"
    >
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot></slot>
        </span>
        ${endSlotTemplate(context, definition)}
    </template>
`;
