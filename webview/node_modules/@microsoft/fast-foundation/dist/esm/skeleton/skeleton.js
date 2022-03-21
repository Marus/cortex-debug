import { __decorate } from "tslib";
import { attr } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * A Skeleton Custom HTML Element.
 *
 * @public
 */
export class Skeleton extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * Indicates what the shape of the Skeleton should be.
         *
         * @public
         * @remarks
         * HTML Attribute: shape
         */
        this.shape = "rect";
    }
}
__decorate([
    attr
], Skeleton.prototype, "fill", void 0);
__decorate([
    attr
], Skeleton.prototype, "shape", void 0);
__decorate([
    attr
], Skeleton.prototype, "pattern", void 0);
__decorate([
    attr({ mode: "boolean" })
], Skeleton.prototype, "shimmer", void 0);
