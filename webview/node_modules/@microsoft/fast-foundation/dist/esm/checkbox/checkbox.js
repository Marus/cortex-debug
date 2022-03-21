import { __decorate } from "tslib";
import { attr, observable } from "@microsoft/fast-element";
import { keySpace } from "@microsoft/fast-web-utilities";
import { FormAssociatedCheckbox } from "./checkbox.form-associated";
/**
 * A Checkbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#checkbox | ARIA checkbox }.
 *
 * @public
 */
export class Checkbox extends FormAssociatedCheckbox {
    constructor() {
        super();
        /**
         * The element's value to be included in form submission when checked.
         * Default to "on" to reach parity with input[type="checkbox"]
         *
         * @internal
         */
        this.initialValue = "on";
        /**
         * The indeterminate state of the control
         */
        this.indeterminate = false;
        /**
         * @internal
         */
        this.keypressHandler = (e) => {
            switch (e.key) {
                case keySpace:
                    this.checked = !this.checked;
                    break;
            }
        };
        /**
         * @internal
         */
        this.clickHandler = (e) => {
            if (!this.disabled && !this.readOnly) {
                this.checked = !this.checked;
            }
        };
        this.proxy.setAttribute("type", "checkbox");
    }
    readOnlyChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.readOnly = this.readOnly;
        }
    }
}
__decorate([
    attr({ attribute: "readonly", mode: "boolean" })
], Checkbox.prototype, "readOnly", void 0);
__decorate([
    observable
], Checkbox.prototype, "defaultSlottedNodes", void 0);
__decorate([
    observable
], Checkbox.prototype, "indeterminate", void 0);
