import { __decorate } from "tslib";
import { attr, DOM, observable } from "@microsoft/fast-element";
import { getDisplayedNodes, isHTMLElement, keyArrowDown, keyArrowLeft, keyArrowRight, keyArrowUp, keyEnd, keyEnter, keyHome, } from "@microsoft/fast-web-utilities";
import { isTreeItemElement, TreeItem } from "../tree-item";
import { FoundationElement } from "../foundation-element";
/**
 * A Tree view Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria-practices/#TreeView | ARIA TreeView }.
 *
 * @public
 */
export class TreeView extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * The tree item that is designated to be in the tab queue.
         *
         * @internal
         */
        this.currentFocused = null;
        /**
         * Handle focus events
         *
         * @internal
         */
        this.handleFocus = (e) => {
            if (this.slottedTreeItems.length < 1) {
                // no child items, nothing to do
                return;
            }
            if (e.target === this) {
                if (this.currentFocused === null) {
                    this.currentFocused = this.getValidFocusableItem();
                }
                if (this.currentFocused !== null) {
                    TreeItem.focusItem(this.currentFocused);
                }
                return;
            }
            if (this.contains(e.target)) {
                this.setAttribute("tabindex", "-1");
                this.currentFocused = e.target;
            }
        };
        /**
         * Handle blur events
         *
         * @internal
         */
        this.handleBlur = (e) => {
            if (e.target instanceof HTMLElement &&
                (e.relatedTarget === null || !this.contains(e.relatedTarget))) {
                this.setAttribute("tabindex", "0");
            }
        };
        /**
         * KeyDown handler
         *
         *  @internal
         */
        this.handleKeyDown = (e) => {
            if (e.defaultPrevented) {
                return;
            }
            if (this.slottedTreeItems.length < 1) {
                return true;
            }
            const treeItems = this.getVisibleNodes();
            switch (e.key) {
                case keyHome:
                    if (treeItems.length) {
                        TreeItem.focusItem(treeItems[0]);
                    }
                    return;
                case keyEnd:
                    if (treeItems.length) {
                        TreeItem.focusItem(treeItems[treeItems.length - 1]);
                    }
                    return;
                case keyArrowLeft:
                    if (e.target && this.isFocusableElement(e.target)) {
                        const item = e.target;
                        if (item instanceof TreeItem && item.childItemLength() > 0) {
                            item.expanded = false;
                        }
                    }
                    return false;
                case keyArrowRight:
                    if (e.target && this.isFocusableElement(e.target)) {
                        const item = e.target;
                        if (item instanceof TreeItem && item.childItemLength() > 0) {
                            item.expanded = true;
                        }
                    }
                    return;
                case keyArrowDown:
                    if (e.target && this.isFocusableElement(e.target)) {
                        this.focusNextNode(1, e.target);
                    }
                    return;
                case keyArrowUp:
                    if (e.target && this.isFocusableElement(e.target)) {
                        this.focusNextNode(-1, e.target);
                    }
                    return;
                case keyEnter:
                    // In single-select trees where selection does not follow focus (see note below),
                    // the default action is typically to select the focused node.
                    this.handleClick(e);
                    return;
            }
            // don't prevent default if we took no action
            return true;
        };
        /**
         * Handles the selected-changed events bubbling up
         * from child tree items
         *
         *  @internal
         */
        this.handleSelectedChange = (e) => {
            if (e.defaultPrevented) {
                return;
            }
            if (!(e.target instanceof Element) || !isTreeItemElement(e.target)) {
                return true;
            }
            const item = e.target;
            if (item.selected) {
                if (this.currentSelected && this.currentSelected !== item) {
                    this.currentSelected.selected = false;
                }
                // new selected item
                this.currentSelected = item;
            }
            else if (!item.selected && this.currentSelected === item) {
                // selected item deselected
                this.currentSelected = null;
            }
            return;
        };
        /**
         * Updates the tree view when slottedTreeItems changes
         */
        this.setItems = () => {
            // force single selection
            // defaults to first one found
            const selectedItem = this.treeView.querySelector("[aria-selected='true']");
            this.currentSelected = selectedItem;
            // invalidate the current focused item if it is no longer valid
            if (this.currentFocused === null || !this.contains(this.currentFocused)) {
                this.currentFocused = this.getValidFocusableItem();
            }
            // toggle properties on child elements
            this.nested = this.checkForNestedItems();
            const treeItems = this.getVisibleNodes();
            treeItems.forEach(node => {
                if (isTreeItemElement(node)) {
                    node.nested = this.nested;
                }
            });
        };
        /**
         * check if the item is focusable
         */
        this.isFocusableElement = (el) => {
            return isTreeItemElement(el);
        };
        this.isSelectedElement = (el) => {
            return el.selected;
        };
    }
    slottedTreeItemsChanged() {
        if (this.$fastController.isConnected) {
            // update for slotted children change
            this.setItems();
        }
    }
    connectedCallback() {
        super.connectedCallback();
        this.setAttribute("tabindex", "0");
        DOM.queueUpdate(() => {
            this.setItems();
        });
    }
    /**
     * Handles click events bubbling up
     *
     *  @internal
     */
    handleClick(e) {
        if (e.defaultPrevented) {
            // handled, do nothing
            return;
        }
        if (!(e.target instanceof Element) || !isTreeItemElement(e.target)) {
            // not a tree item, ignore
            return true;
        }
        const item = e.target;
        if (!item.disabled) {
            item.selected = !item.selected;
        }
        return;
    }
    /**
     * Move focus to a tree item based on its offset from the provided item
     */
    focusNextNode(delta, item) {
        const visibleNodes = this.getVisibleNodes();
        if (!visibleNodes) {
            return;
        }
        const focusItem = visibleNodes[visibleNodes.indexOf(item) + delta];
        if (isHTMLElement(focusItem)) {
            TreeItem.focusItem(focusItem);
        }
    }
    /**
     * checks if there are any nested tree items
     */
    getValidFocusableItem() {
        const treeItems = this.getVisibleNodes();
        // default to selected element if there is one
        let focusIndex = treeItems.findIndex(this.isSelectedElement);
        if (focusIndex === -1) {
            // otherwise first focusable tree item
            focusIndex = treeItems.findIndex(this.isFocusableElement);
        }
        if (focusIndex !== -1) {
            return treeItems[focusIndex];
        }
        return null;
    }
    /**
     * checks if there are any nested tree items
     */
    checkForNestedItems() {
        return this.slottedTreeItems.some((node) => {
            return isTreeItemElement(node) && node.querySelector("[role='treeitem']");
        });
    }
    getVisibleNodes() {
        return getDisplayedNodes(this, "[role='treeitem']") || [];
    }
}
__decorate([
    attr({ attribute: "render-collapsed-nodes" })
], TreeView.prototype, "renderCollapsedNodes", void 0);
__decorate([
    observable
], TreeView.prototype, "currentSelected", void 0);
__decorate([
    observable
], TreeView.prototype, "slottedTreeItems", void 0);
