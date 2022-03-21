import { SyntheticViewTemplate } from "@microsoft/fast-element";
import { StartEnd, StartEndOptions } from "../patterns/start-end";
import { FoundationElement, FoundationElementDefinition } from "../foundation-element";
/**
 * check if the item is a tree item
 * @public
 * @remarks
 * determines if element is an HTMLElement and if it has the role treeitem
 */
export declare function isTreeItemElement(el: Element): el is HTMLElement;
/**
 * Tree Item configuration options
 * @public
 */
export declare type TreeItemOptions = FoundationElementDefinition & StartEndOptions & {
    expandCollapseGlyph?: string | SyntheticViewTemplate;
};
/**
 * A Tree item Custom HTML Element.
 *
 * @public
 */
export declare class TreeItem extends FoundationElement {
    /**
     * When true, the control will be appear expanded by user interaction.
     * @public
     * @remarks
     * HTML Attribute: expanded
     */
    expanded: boolean;
    private expandedChanged;
    /**
     * When true, the control will appear selected by user interaction.
     * @public
     * @remarks
     * HTML Attribute: selected
     */
    selected: boolean;
    private selectedChanged;
    /**
     * When true, the control will be immutable by user interaction. See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/disabled | disabled HTML attribute} for more information.
     * @public
     * @remarks
     * HTML Attribute: disabled
     */
    disabled: boolean;
    /**
     *  Reference to the expand/collapse button
     *
     * @internal
     */
    expandCollapseButton: HTMLDivElement;
    /**
     * Whether the item is focusable
     *
     * @internal
     */
    focusable: boolean;
    /**
     *
     *
     * @internal
     */
    childItems: HTMLElement[];
    /**
     * The slotted child tree items
     *
     * @internal
     */
    items: HTMLElement[];
    private itemsChanged;
    /**
     * Indicates if the tree item is nested
     *
     * @internal
     */
    nested: boolean;
    /**
     *
     *
     * @internal
     */
    renderCollapsedChildren: boolean;
    /**
     * Places document focus on a tree item
     *
     * @public
     * @param el - the element to focus
     */
    static focusItem(el: HTMLElement): void;
    /**
     * Whether the tree is nested
     *
     * @public
     */
    readonly isNestedItem: () => boolean;
    /**
     * Handle expand button click
     *
     * @internal
     */
    handleExpandCollapseButtonClick: (e: MouseEvent) => void;
    /**
     * Handle focus events
     *
     * @internal
     */
    handleFocus: (e: FocusEvent) => void;
    /**
     * Handle blur events
     *
     * @internal
     */
    handleBlur: (e: FocusEvent) => void;
    /**
     * Gets number of children
     *
     * @internal
     */
    childItemLength(): number;
}
/**
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast-dna/issues/3317
 * @internal
 */
export interface TreeItem extends StartEnd {
}
