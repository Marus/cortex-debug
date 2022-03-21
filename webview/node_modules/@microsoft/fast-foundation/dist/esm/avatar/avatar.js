import { __decorate } from "tslib";
import { attr } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * An Avatar Custom HTML Element
 *
 * @public
 */
export class Avatar extends FoundationElement {
    /**
     * Internal
     */
    connectedCallback() {
        super.connectedCallback();
        if (!this.shape) {
            this.shape = "circle";
        }
    }
}
__decorate([
    attr
], Avatar.prototype, "fill", void 0);
__decorate([
    attr
], Avatar.prototype, "color", void 0);
__decorate([
    attr
], Avatar.prototype, "link", void 0);
__decorate([
    attr
], Avatar.prototype, "shape", void 0);
