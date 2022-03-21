import { html, ref, slotted } from "@microsoft/fast-element";
/**
 * The template for the {@link @microsoft/fast-foundation#TreeView} component.
 * @public
 */
export const treeViewTemplate = (context, definition) => html `
    <template
        role="tree"
        ${ref("treeView")}
        @keydown="${(x, c) => x.handleKeyDown(c.event)}"
        @focusin="${(x, c) => x.handleFocus(c.event)}"
        @focusout="${(x, c) => x.handleBlur(c.event)}"
        @click="${(x, c) => x.handleClick(c.event)}"
        @selected-change="${(x, c) => x.handleSelectedChange(c.event)}"
    >
        <slot ${slotted("slottedTreeItems")}></slot>
    </template>
`;
