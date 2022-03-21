import { html } from "@microsoft/fast-element";
/**
 *
 * @public
 */
export const pickerListTemplate = (context, definition) => {
    return html `
        <template slot="list-region" role="list" class="picker-list">
            <slot></slot>
            <slot name="input-region"></slot>
        </template>
    `;
};
