import { __decorate } from "tslib";
import { attr, nullableNumberConverter, observable, } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * An Progress HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#progressbar | ARIA progressbar }.
 *
 * @public
 */
export class BaseProgress extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * Indicates progress in %
         * @internal
         */
        this.percentComplete = 0;
    }
    valueChanged() {
        if (this.$fastController.isConnected) {
            this.updatePercentComplete();
        }
    }
    minChanged() {
        if (this.$fastController.isConnected) {
            this.updatePercentComplete();
        }
    }
    maxChanged() {
        if (this.$fastController.isConnected) {
            this.updatePercentComplete();
        }
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.updatePercentComplete();
    }
    updatePercentComplete() {
        const min = typeof this.min === "number" ? this.min : 0;
        const max = typeof this.max === "number" ? this.max : 100;
        const value = typeof this.value === "number" ? this.value : 0;
        const range = max - min;
        this.percentComplete =
            range === 0 ? 0 : Math.fround(((value - min) / range) * 100);
    }
}
__decorate([
    attr({ converter: nullableNumberConverter })
], BaseProgress.prototype, "value", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], BaseProgress.prototype, "min", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], BaseProgress.prototype, "max", void 0);
__decorate([
    attr({ mode: "boolean" })
], BaseProgress.prototype, "paused", void 0);
__decorate([
    observable
], BaseProgress.prototype, "percentComplete", void 0);
