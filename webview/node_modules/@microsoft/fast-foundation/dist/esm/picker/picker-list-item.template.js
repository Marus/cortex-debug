import { html } from "@microsoft/fast-element";
/**
 *
 * @public
 */
export const pickerListItemTemplate = (context, definition) => {
    return html `
        <template
            role="listitem"
            tabindex="0"
            @click="${(x, c) => x.handleClick(c.event)}"
            @keydown="${(x, c) => x.handleKeyDown(c.event)}"
        >
            <slot></slot>
        </template>
    `;
};
