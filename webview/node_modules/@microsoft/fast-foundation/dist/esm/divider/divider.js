import { __decorate } from "tslib";
import { attr } from "@microsoft/fast-element";
import { Orientation } from "@microsoft/fast-web-utilities";
import { FoundationElement } from "../foundation-element";
import { DividerRole } from "./divider.options";
export { DividerRole };
/**
 * A Divider Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#separator | ARIA separator } or {@link https://www.w3.org/TR/wai-aria-1.1/#presentation | ARIA presentation}.
 *
 * @public
 */
export class Divider extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * The role of the element.
         *
         * @public
         * @defaultValue - {@link DividerRole.separator}
         * @remarks
         * HTML Attribute: role
         */
        this.role = DividerRole.separator;
        /**
         * The orientation of the divider.
         *
         * @public
         * @remarks
         * HTML Attribute: orientation
         */
        this.orientation = Orientation.horizontal;
    }
}
__decorate([
    attr
], Divider.prototype, "role", void 0);
__decorate([
    attr
], Divider.prototype, "orientation", void 0);
