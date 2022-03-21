import { html } from "@microsoft/fast-element";
/**
 *
 * @public
 */
export const pickerMenuOptionTemplate = (context, definition) => {
    return html `
        <template
            role="listitem"
            tabindex="-1"
            @click="${(x, c) => x.handleClick(c.event)}"
        >
            <slot></slot>
        </template>
    `;
};
