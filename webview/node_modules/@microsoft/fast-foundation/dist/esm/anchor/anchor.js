import { __decorate } from "tslib";
import { attr, observable } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
import { ARIAGlobalStatesAndProperties, StartEnd, } from "../patterns/index";
import { applyMixins } from "../utilities/apply-mixins";
/**
 * An Anchor Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a | <a> element }.
 *
 * @public
 */
export class Anchor extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * Overrides the focus call for where delegatesFocus is unsupported.
         * This check works for Chrome, Edge Chromium, FireFox, and Safari
         * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
         */
        this.handleUnsupportedDelegatesFocus = () => {
            var _a;
            // Check to see if delegatesFocus is supported
            if (window.ShadowRoot &&
                !window.ShadowRoot.prototype.hasOwnProperty("delegatesFocus") && ((_a = this.$fastController.definition.shadowOptions) === null || _a === void 0 ? void 0 : _a.delegatesFocus)) {
                this.focus = () => {
                    this.control.focus();
                };
            }
        };
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.handleUnsupportedDelegatesFocus();
    }
}
__decorate([
    attr
], Anchor.prototype, "download", void 0);
__decorate([
    attr
], Anchor.prototype, "href", void 0);
__decorate([
    attr
], Anchor.prototype, "hreflang", void 0);
__decorate([
    attr
], Anchor.prototype, "ping", void 0);
__decorate([
    attr
], Anchor.prototype, "referrerpolicy", void 0);
__decorate([
    attr
], Anchor.prototype, "rel", void 0);
__decorate([
    attr
], Anchor.prototype, "target", void 0);
__decorate([
    attr
], Anchor.prototype, "type", void 0);
__decorate([
    observable
], Anchor.prototype, "defaultSlottedContent", void 0);
/**
 * Includes ARIA states and properties relating to the ARIA link role
 *
 * @public
 */
export class DelegatesARIALink {
}
__decorate([
    attr({ attribute: "aria-expanded", mode: "fromView" })
], DelegatesARIALink.prototype, "ariaExpanded", void 0);
applyMixins(DelegatesARIALink, ARIAGlobalStatesAndProperties);
applyMixins(Anchor, StartEnd, DelegatesARIALink);
