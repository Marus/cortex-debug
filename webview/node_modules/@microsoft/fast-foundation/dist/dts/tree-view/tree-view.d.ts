import { TreeItem } from "../tree-item";
import { FoundationElement } from "../foundation-element";
/**
 * A Tree view Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria-practices/#TreeView | ARIA TreeView }.
 *
 * @public
 */
export declare class TreeView extends FoundationElement {
    /**
   /**
    * When true, the control will be appear expanded by user interaction.
    * @public
    * @remarks
    * HTML Attribute: render-collapsed-nodes
    */
    renderCollapsedNodes: boolean;
    /**
     * The currently selected tree item
     * @public
     */
    currentSelected: HTMLElement | TreeItem | null;
    /**
     *  Slotted children
     *
     * @internal
     */
    slottedTreeItems: HTMLElement[];
    private slottedTreeItemsChanged;
    /**
     * The tree item that is designated to be in the tab queue.
     *
     * @internal
     */
    currentFocused: HTMLElement | TreeItem | null;
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
     * ref to the tree item
     *
     * @internal
     */
    treeView: HTMLElement;
    private nested;
    connectedCallback(): void;
    /**
     * KeyDown handler
     *
     *  @internal
     */
    handleKeyDown: (e: KeyboardEvent) => boolean | void;
    /**
     * Handles click events bubbling up
     *
     *  @internal
     */
    handleClick(e: Event): boolean | void;
    /**
     * Handles the selected-changed events bubbling up
     * from child tree items
     *
     *  @internal
     */
    handleSelectedChange: (e: Event) => boolean | void;
    /**
     * Move focus to a tree item based on its offset from the provided item
     */
    private focusNextNode;
    /**
     * Updates the tree view when slottedTreeItems changes
     */
    private setItems;
    /**
     * checks if there are any nested tree items
     */
    private getValidFocusableItem;
    /**
     * checks if there are any nested tree items
     */
    private checkForNestedItems;
    /**
     * check if the item is focusable
     */
    private isFocusableElement;
    private isSelectedElement;
    private getVisibleNodes;
}
