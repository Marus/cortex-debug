import { __decorate } from "tslib";
import { observable } from "@microsoft/fast-element";
import { Anchor, DelegatesARIALink } from "../anchor";
import { StartEnd } from "../patterns/index";
import { applyMixins } from "../utilities/apply-mixins";
/**
 * A Breadcrumb Item Custom HTML Element.
 *
 * @public
 */
export class BreadcrumbItem extends Anchor {
    constructor() {
        super(...arguments);
        /**
         * @internal
         */
        this.separator = true;
    }
}
__decorate([
    observable
], BreadcrumbItem.prototype, "separator", void 0);
applyMixins(BreadcrumbItem, StartEnd, DelegatesARIALink);
