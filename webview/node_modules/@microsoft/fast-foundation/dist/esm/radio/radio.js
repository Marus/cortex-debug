import { __decorate } from "tslib";
import { attr, observable } from "@microsoft/fast-element";
import { keySpace } from "@microsoft/fast-web-utilities";
import { FormAssociatedRadio } from "./radio.form-associated";
/**
 * A Radio Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#radio | ARIA radio }.
 *
 * @public
 */
export class Radio extends FormAssociatedRadio {
    constructor() {
        super();
        /**
         * The element's value to be included in form submission when checked.
         * Default to "on" to reach parity with input[type="radio"]
         *
         * @internal
         */
        this.initialValue = "on";
        /**
         * @internal
         */
        this.keypressHandler = (e) => {
            switch (e.key) {
                case keySpace:
                    if (!this.checked && !this.readOnly) {
                        this.checked = true;
                    }
                    return;
            }
            return true;
        };
        this.proxy.setAttribute("type", "radio");
    }
    readOnlyChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.readOnly = this.readOnly;
        }
    }
    /**
     * @internal
     */
    defaultCheckedChanged() {
        var _a;
        if (this.$fastController.isConnected && !this.dirtyChecked) {
            // Setting this.checked will cause us to enter a dirty state,
            // but if we are clean when defaultChecked is changed, we want to stay
            // in a clean state, so reset this.dirtyChecked
            if (!this.isInsideRadioGroup()) {
                this.checked = (_a = this.defaultChecked) !== null && _a !== void 0 ? _a : false;
                this.dirtyChecked = false;
            }
        }
    }
    /**
     * @internal
     */
    connectedCallback() {
        var _a, _b;
        super.connectedCallback();
        this.validate();
        if (((_a = this.parentElement) === null || _a === void 0 ? void 0 : _a.getAttribute("role")) !== "radiogroup" &&
            this.getAttribute("tabindex") === null) {
            if (!this.disabled) {
                this.setAttribute("tabindex", "0");
            }
        }
        if (this.checkedAttribute) {
            if (!this.dirtyChecked) {
                // Setting this.checked will cause us to enter a dirty state,
                // but if we are clean when defaultChecked is changed, we want to stay
                // in a clean state, so reset this.dirtyChecked
                if (!this.isInsideRadioGroup()) {
                    this.checked = (_b = this.defaultChecked) !== null && _b !== void 0 ? _b : false;
                    this.dirtyChecked = false;
                }
            }
        }
    }
    isInsideRadioGroup() {
        const parent = this.closest("[role=radiogroup]");
        return parent !== null;
    }
    /**
     * @internal
     */
    clickHandler(e) {
        if (!this.disabled && !this.readOnly && !this.checked) {
            this.checked = true;
        }
    }
}
__decorate([
    attr({ attribute: "readonly", mode: "boolean" })
], Radio.prototype, "readOnly", void 0);
__decorate([
    observable
], Radio.prototype, "name", void 0);
__decorate([
    observable
], Radio.prototype, "defaultSlottedNodes", void 0);
