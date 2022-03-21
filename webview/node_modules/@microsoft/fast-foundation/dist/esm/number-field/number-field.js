import { __decorate } from "tslib";
import { attr, DOM, nullableNumberConverter, observable, } from "@microsoft/fast-element";
import { keyArrowDown, keyArrowUp } from "@microsoft/fast-web-utilities";
import { StartEnd } from "../patterns/index";
import { applyMixins } from "../utilities/index";
import { DelegatesARIATextbox } from "../text-field/index";
import { FormAssociatedNumberField } from "./number-field.form-associated";
/**
 * A Number Field Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/number | <input type="number" /> element }.
 *
 * @public
 */
export class NumberField extends FormAssociatedNumberField {
    constructor() {
        super(...arguments);
        /**
         * When true, spin buttons will not be rendered
         * @public
         * @remarks
         * HTML Attribute: autofocus
         */
        this.hideStep = false;
        /**
         * Amount to increment or decrement the value by
         * @public
         * @remarks
         * HTMLAttribute: step
         */
        this.step = 1;
        /**
         * Flag to indicate that the value change is from the user input
         * @internal
         */
        this.isUserInput = false;
    }
    /**
     * Ensures that the max is greater than the min and that the value
     *  is less than the max
     * @param previous - the previous max value
     * @param next - updated max value
     *
     * @internal
     */
    maxChanged(previous, next) {
        var _a;
        this.max = Math.max(next, (_a = this.min) !== null && _a !== void 0 ? _a : next);
        const min = Math.min(this.min, this.max);
        if (this.min !== undefined && this.min !== min) {
            this.min = min;
        }
        this.value = this.getValidValue(this.value);
    }
    /**
     * Ensures that the min is less than the max and that the value
     *  is greater than the min
     * @param previous - previous min value
     * @param next - updated min value
     *
     * @internal
     */
    minChanged(previous, next) {
        var _a;
        this.min = Math.min(next, (_a = this.max) !== null && _a !== void 0 ? _a : next);
        const max = Math.max(this.min, this.max);
        if (this.max !== undefined && this.max !== max) {
            this.max = max;
        }
        this.value = this.getValidValue(this.value);
    }
    /**
     * The value property, typed as a number.
     *
     * @public
     */
    get valueAsNumber() {
        return parseFloat(super.value);
    }
    set valueAsNumber(next) {
        this.value = next.toString();
    }
    /**
     * Validates that the value is a number between the min and max
     * @param previous - previous stored value
     * @param next - value being updated
     * @param updateControl - should the text field be updated with value, defaults to true
     * @internal
     */
    valueChanged(previous, next) {
        this.value = this.getValidValue(next);
        if (next !== this.value) {
            return;
        }
        if (this.control && !this.isUserInput) {
            this.control.value = this.value;
        }
        super.valueChanged(previous, this.value);
        if (previous !== undefined && !this.isUserInput) {
            this.$emit("input");
            this.$emit("change");
        }
        this.isUserInput = false;
    }
    /**
     * Sets the internal value to a valid number between the min and max properties
     * @param value - user input
     *
     * @internal
     */
    getValidValue(value) {
        var _a, _b;
        let validValue = parseFloat(parseFloat(value).toPrecision(12));
        if (isNaN(validValue)) {
            validValue = "";
        }
        else {
            validValue = Math.min(validValue, (_a = this.max) !== null && _a !== void 0 ? _a : validValue);
            validValue = Math.max(validValue, (_b = this.min) !== null && _b !== void 0 ? _b : validValue).toString();
        }
        return validValue;
    }
    /**
     * Increments the value using the step value
     *
     * @public
     */
    stepUp() {
        const value = parseFloat(this.value);
        const stepUpValue = !isNaN(value)
            ? value + this.step
            : this.min > 0
                ? this.min
                : this.max < 0
                    ? this.max
                    : !this.min
                        ? this.step
                        : 0;
        this.value = stepUpValue.toString();
    }
    /**
     * Decrements the value using the step value
     *
     * @public
     */
    stepDown() {
        const value = parseFloat(this.value);
        const stepDownValue = !isNaN(value)
            ? value - this.step
            : this.min > 0
                ? this.min
                : this.max < 0
                    ? this.max
                    : !this.min
                        ? 0 - this.step
                        : 0;
        this.value = stepDownValue.toString();
    }
    /**
     * Sets up the initial state of the number field
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.proxy.setAttribute("type", "number");
        this.validate();
        this.control.value = this.value;
        if (this.autofocus) {
            DOM.queueUpdate(() => {
                this.focus();
            });
        }
    }
    /**
     * Handles the internal control's `input` event
     * @internal
     */
    handleTextInput() {
        this.control.value = this.control.value.replace(/[^0-9\-+e.]/g, "");
        this.isUserInput = true;
        this.value = this.control.value;
    }
    /**
     * Change event handler for inner control.
     * @remarks
     * "Change" events are not `composable` so they will not
     * permeate the shadow DOM boundary. This fn effectively proxies
     * the change event, emitting a `change` event whenever the internal
     * control emits a `change` event
     * @internal
     */
    handleChange() {
        this.$emit("change");
    }
    /**
     * Handles the internal control's `keydown` event
     * @internal
     */
    handleKeyDown(e) {
        const key = e.key;
        switch (key) {
            case keyArrowUp:
                this.stepUp();
                return false;
            case keyArrowDown:
                this.stepDown();
                return false;
        }
        return true;
    }
    /**
     * Handles populating the input field with a validated value when
     *  leaving the input field.
     * @internal
     */
    handleBlur() {
        this.control.value = this.value;
    }
}
__decorate([
    attr({ attribute: "readonly", mode: "boolean" })
], NumberField.prototype, "readOnly", void 0);
__decorate([
    attr({ mode: "boolean" })
], NumberField.prototype, "autofocus", void 0);
__decorate([
    attr({ attribute: "hide-step", mode: "boolean" })
], NumberField.prototype, "hideStep", void 0);
__decorate([
    attr
], NumberField.prototype, "placeholder", void 0);
__decorate([
    attr
], NumberField.prototype, "list", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "maxlength", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "minlength", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "size", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "step", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "max", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], NumberField.prototype, "min", void 0);
__decorate([
    observable
], NumberField.prototype, "defaultSlottedNodes", void 0);
applyMixins(NumberField, StartEnd, DelegatesARIATextbox);
