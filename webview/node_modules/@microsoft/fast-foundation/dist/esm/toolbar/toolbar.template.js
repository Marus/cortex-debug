import { elements, html, slotted } from "@microsoft/fast-element";
import { endSlotTemplate, startSlotTemplate } from "../patterns";
/**
 * The template for the {@link @microsoft/fast-foundation#(Toolbar:class)} component.
 *
 * @public
 */
export const toolbarTemplate = (context, definition) => html `
    <template
        aria-label="${x => x.ariaLabel}"
        aria-labelledby="${x => x.ariaLabelledby}"
        aria-orientation="${x => x.orientation}"
        orientation="${x => x.orientation}"
        role="toolbar"
        @click="${(x, c) => x.clickHandler(c.event)}"
        @focusin="${(x, c) => x.focusinHandler(c.event)}"
        @keydown="${(x, c) => x.keydownHandler(c.event)}"
    >
        <slot name="label"></slot>
        <div class="positioning-region" part="positioning-region">
            ${startSlotTemplate(context, definition)}
            <slot
                ${slotted({
    filter: elements(),
    property: "slottedItems",
})}
            ></slot>
            ${endSlotTemplate(context, definition)}
        </div>
    </template>
`;
