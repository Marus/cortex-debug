import { __decorate } from "tslib";
import { observable } from "@microsoft/fast-element";
import { BreadcrumbItem } from "../breadcrumb-item";
import { FoundationElement } from "../foundation-element";
/**
 * A Breadcrumb Custom HTML Element.
 *
 * @public
 */
export class Breadcrumb extends FoundationElement {
    slottedBreadcrumbItemsChanged() {
        if (this.$fastController.isConnected) {
            if (this.slottedBreadcrumbItems === undefined ||
                this.slottedBreadcrumbItems.length === 0) {
                return;
            }
            const lastNode = this.slottedBreadcrumbItems[this.slottedBreadcrumbItems.length - 1];
            this.setItemSeparator(lastNode);
            this.setLastItemAriaCurrent(lastNode);
        }
    }
    setItemSeparator(lastNode) {
        this.slottedBreadcrumbItems.forEach((item) => {
            if (item instanceof BreadcrumbItem) {
                item.separator = true;
            }
        });
        if (lastNode instanceof BreadcrumbItem) {
            lastNode.separator = false;
        }
    }
    /**
     * @internal
     * Finds href on childnodes in the light DOM or shadow DOM.
     * We look in the shadow DOM because we insert an anchor when breadcrumb-item has an href.
     */
    findChildWithHref(node) {
        var _a, _b;
        if (node.childElementCount > 0) {
            return node.querySelector("a[href]");
        }
        else if ((_a = node.shadowRoot) === null || _a === void 0 ? void 0 : _a.childElementCount) {
            return (_b = node.shadowRoot) === null || _b === void 0 ? void 0 : _b.querySelector("a[href]");
        }
        else
            return null;
    }
    /**
     *  If child node with an anchor tag and with href is found then apply aria-current to child node otherwise apply aria-current to the host element, with an href
     */
    setLastItemAriaCurrent(lastNode) {
        const childNodeWithHref = this.findChildWithHref(lastNode);
        if (childNodeWithHref === null &&
            lastNode.hasAttribute("href") &&
            lastNode instanceof BreadcrumbItem) {
            lastNode.ariaCurrent = "page";
        }
        else if (childNodeWithHref !== null) {
            childNodeWithHref.setAttribute("aria-current", "page");
        }
    }
}
__decorate([
    observable
], Breadcrumb.prototype, "slottedBreadcrumbItems", void 0);
