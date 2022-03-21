import { __decorate } from "tslib";
import { attr } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * A Badge Custom HTML Element.
 *
 * @public
 */
export class Badge extends FoundationElement {
    constructor() {
        super(...arguments);
        this.generateBadgeStyle = () => {
            if (!this.fill && !this.color) {
                return;
            }
            const fill = `background-color: var(--badge-fill-${this.fill});`;
            const color = `color: var(--badge-color-${this.color});`;
            if (this.fill && !this.color) {
                return fill;
            }
            else if (this.color && !this.fill) {
                return color;
            }
            else {
                return `${color} ${fill}`;
            }
        };
    }
}
__decorate([
    attr({ attribute: "fill" })
], Badge.prototype, "fill", void 0);
__decorate([
    attr({ attribute: "color" })
], Badge.prototype, "color", void 0);
__decorate([
    attr({ mode: "boolean" })
], Badge.prototype, "circular", void 0);
