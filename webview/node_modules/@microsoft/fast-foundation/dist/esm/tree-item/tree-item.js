import { __decorate } from "tslib";
import { attr, observable } from "@microsoft/fast-element";
import { isHTMLElement } from "@microsoft/fast-web-utilities";
import { StartEnd } from "../patterns/start-end";
import { applyMixins } from "../utilities/apply-mixins";
import { FoundationElement } from "../foundation-element";
/**
 * check if the item is a tree item
 * @public
 * @remarks
 * determines if element is an HTMLElement and if it has the role treeitem
 */
export function isTreeItemElement(el) {
    return isHTMLElement(el) && el.getAttribute("role") === "treeitem";
}
/**
 * A Tree item Custom HTML Element.
 *
 * @public
 */
export class TreeItem extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * When true, the control will be appear expanded by user interaction.
         * @public
         * @remarks
         * HTML Attribute: expanded
         */
        this.expanded = false;
        /**
         * Whether the item is focusable
         *
         * @internal
         */
        this.focusable = false;
        /**
         * Whether the tree is nested
         *
         * @public
         */
        this.isNestedItem = () => {
            return isTreeItemElement(this.parentElement);
        };
        /**
         * Handle expand button click
         *
         * @internal
         */
        this.handleExpandCollapseButtonClick = (e) => {
            if (!this.disabled && !e.defaultPrevented) {
                this.expanded = !this.expanded;
            }
        };
        /**
         * Handle focus events
         *
         * @internal
         */
        this.handleFocus = (e) => {
            this.setAttribute("tabindex", "0");
        };
        /**
         * Handle blur events
         *
         * @internal
         */
        this.handleBlur = (e) => {
            this.setAttribute("tabindex", "-1");
        };
    }
    expandedChanged() {
        if (this.$fastController.isConnected) {
            this.$emit("expanded-change", this);
        }
    }
    selectedChanged() {
        if (this.$fastController.isConnected) {
            this.$emit("selected-change", this);
        }
    }
    itemsChanged(oldValue, newValue) {
        if (this.$fastController.isConnected) {
            this.items.forEach((node) => {
                if (isTreeItemElement(node)) {
                    // TODO: maybe not require it to be a TreeItem?
                    node.nested = true;
                }
            });
        }
    }
    /**
     * Places document focus on a tree item
     *
     * @public
     * @param el - the element to focus
     */
    static focusItem(el) {
        el.focusable = true;
        el.focus();
    }
    /**
     * Gets number of children
     *
     * @internal
     */
    childItemLength() {
        const treeChildren = this.childItems.filter((item) => {
            return isTreeItemElement(item);
        });
        return treeChildren ? treeChildren.length : 0;
    }
}
__decorate([
    attr({ mode: "boolean" })
], TreeItem.prototype, "expanded", void 0);
__decorate([
    attr({ mode: "boolean" })
], TreeItem.prototype, "selected", void 0);
__decorate([
    attr({ mode: "boolean" })
], TreeItem.prototype, "disabled", void 0);
__decorate([
    observable
], TreeItem.prototype, "focusable", void 0);
__decorate([
    observable
], TreeItem.prototype, "childItems", void 0);
__decorate([
    observable
], TreeItem.prototype, "items", void 0);
__decorate([
    observable
], TreeItem.prototype, "nested", void 0);
__decorate([
    observable
], TreeItem.prototype, "renderCollapsedChildren", void 0);
applyMixins(TreeItem, StartEnd);
