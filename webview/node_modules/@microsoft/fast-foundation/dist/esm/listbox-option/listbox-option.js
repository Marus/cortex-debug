import { __decorate } from "tslib";
import { attr, observable, Observable } from "@microsoft/fast-element";
import { isHTMLElement } from "@microsoft/fast-web-utilities";
import { FoundationElement } from "../foundation-element";
import { ARIAGlobalStatesAndProperties } from "../patterns";
import { StartEnd } from "../patterns/start-end";
import { applyMixins } from "../utilities/apply-mixins";
/**
 * Determines if the element is a {@link (ListboxOption:class)}
 *
 * @param element - the element to test.
 * @public
 */
export function isListboxOption(el) {
    return (isHTMLElement(el) &&
        (el.getAttribute("role") === "option" ||
            el instanceof HTMLOptionElement));
}
/**
 * An Option Custom HTML Element.
 * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#option | ARIA option }.
 *
 * @public
 */
export class ListboxOption extends FoundationElement {
    constructor(text, value, defaultSelected, selected) {
        super();
        /**
         * The defaultSelected state of the option.
         * @public
         */
        this.defaultSelected = false;
        /**
         * Tracks whether the "selected" property has been changed.
         * @internal
         */
        this.dirtySelected = false;
        /**
         * The checked state of the control.
         *
         * @public
         */
        this.selected = this.defaultSelected;
        /**
         * Track whether the value has been changed from the initial value
         */
        this.dirtyValue = false;
        if (text) {
            this.textContent = text;
        }
        if (value) {
            this.initialValue = value;
        }
        if (defaultSelected) {
            this.defaultSelected = defaultSelected;
        }
        if (selected) {
            this.selected = selected;
        }
        this.proxy = new Option(`${this.textContent}`, this.initialValue, this.defaultSelected, this.selected);
        this.proxy.disabled = this.disabled;
    }
    /**
     * Updates the ariaChecked property when the checked property changes.
     *
     * @param prev - the previous checked value
     * @param next - the current checked value
     *
     * @public
     */
    checkedChanged(prev, next) {
        if (typeof next === "boolean") {
            this.ariaChecked = next ? "true" : "false";
            return;
        }
        this.ariaChecked = undefined;
    }
    defaultSelectedChanged() {
        if (!this.dirtySelected) {
            this.selected = this.defaultSelected;
            if (this.proxy instanceof HTMLOptionElement) {
                this.proxy.selected = this.defaultSelected;
            }
        }
    }
    disabledChanged(prev, next) {
        this.ariaDisabled = this.disabled ? "true" : "false";
        if (this.proxy instanceof HTMLOptionElement) {
            this.proxy.disabled = this.disabled;
        }
    }
    selectedAttributeChanged() {
        this.defaultSelected = this.selectedAttribute;
        if (this.proxy instanceof HTMLOptionElement) {
            this.proxy.defaultSelected = this.defaultSelected;
        }
    }
    selectedChanged() {
        this.ariaSelected = this.selected ? "true" : "false";
        if (!this.dirtySelected) {
            this.dirtySelected = true;
        }
        if (this.proxy instanceof HTMLOptionElement) {
            this.proxy.selected = this.selected;
        }
    }
    initialValueChanged(previous, next) {
        // If the value is clean and the component is connected to the DOM
        // then set value equal to the attribute value.
        if (!this.dirtyValue) {
            this.value = this.initialValue;
            this.dirtyValue = false;
        }
    }
    get label() {
        var _a, _b;
        return (_b = (_a = this.value) !== null && _a !== void 0 ? _a : this.textContent) !== null && _b !== void 0 ? _b : "";
    }
    get text() {
        return this.textContent;
    }
    set value(next) {
        this._value = next;
        this.dirtyValue = true;
        if (this.proxy instanceof HTMLElement) {
            this.proxy.value = next;
        }
        Observable.notify(this, "value");
    }
    get value() {
        var _a, _b;
        Observable.track(this, "value");
        return (_b = (_a = this._value) !== null && _a !== void 0 ? _a : this.textContent) !== null && _b !== void 0 ? _b : "";
    }
    get form() {
        return this.proxy ? this.proxy.form : null;
    }
}
__decorate([
    observable
], ListboxOption.prototype, "checked", void 0);
__decorate([
    observable
], ListboxOption.prototype, "defaultSelected", void 0);
__decorate([
    attr({ mode: "boolean" })
], ListboxOption.prototype, "disabled", void 0);
__decorate([
    attr({ attribute: "selected", mode: "boolean" })
], ListboxOption.prototype, "selectedAttribute", void 0);
__decorate([
    observable
], ListboxOption.prototype, "selected", void 0);
__decorate([
    attr({ attribute: "value", mode: "fromView" })
], ListboxOption.prototype, "initialValue", void 0);
/**
 * States and properties relating to the ARIA `option` role.
 *
 * @public
 */
export class DelegatesARIAListboxOption {
}
__decorate([
    observable
], DelegatesARIAListboxOption.prototype, "ariaChecked", void 0);
__decorate([
    observable
], DelegatesARIAListboxOption.prototype, "ariaPosInSet", void 0);
__decorate([
    observable
], DelegatesARIAListboxOption.prototype, "ariaSelected", void 0);
__decorate([
    observable
], DelegatesARIAListboxOption.prototype, "ariaSetSize", void 0);
applyMixins(DelegatesARIAListboxOption, ARIAGlobalStatesAndProperties);
applyMixins(ListboxOption, StartEnd, DelegatesARIAListboxOption);
