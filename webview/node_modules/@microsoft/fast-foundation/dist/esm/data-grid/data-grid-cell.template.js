import { html } from "@microsoft/fast-element";
/**
 * Generates a template for the {@link @microsoft/fast-foundation#DataGridCell} component using
 * the provided prefix.
 * @public
 */
export const dataGridCellTemplate = (context, definition) => {
    return html `
        <template
            tabindex="-1"
            role="${x => !x.cellType || x.cellType === "default" ? "gridcell" : x.cellType}"
            class="
            ${x => x.cellType === "columnheader"
        ? "column-header"
        : x.cellType === "rowheader"
            ? "row-header"
            : ""}
            "
        >
            <slot></slot>
        </template>
    `;
};
