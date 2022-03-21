import { __decorate } from "tslib";
import { attr, observable } from "@microsoft/fast-element";
import { keyEnter, keySpace } from "@microsoft/fast-web-utilities";
import { FormAssociatedSwitch } from "./switch.form-associated";
/**
 * A Switch Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#switch | ARIA switch }.
 *
 * @public
 */
export class Switch extends FormAssociatedSwitch {
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
         * @internal
         */
        this.keypressHandler = (e) => {
            switch (e.key) {
                case keyEnter:
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
        this.readOnly
            ? this.classList.add("readonly")
            : this.classList.remove("readonly");
    }
    /**
     * @internal
     */
    checkedChanged(prev, next) {
        super.checkedChanged(prev, next);
        /**
         * @deprecated - this behavior already exists in the template and should not exist in the class.
         */
        this.checked ? this.classList.add("checked") : this.classList.remove("checked");
    }
}
__decorate([
    attr({ attribute: "readonly", mode: "boolean" })
], Switch.prototype, "readOnly", void 0);
__decorate([
    observable
], Switch.prototype, "defaultSlottedNodes", void 0);
