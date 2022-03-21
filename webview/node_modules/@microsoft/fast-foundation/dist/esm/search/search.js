import { __decorate } from "tslib";
import { attr, DOM, nullableNumberConverter, observable } from "@microsoft/fast-element";
import { ARIAGlobalStatesAndProperties, StartEnd, } from "../patterns/index";
import { applyMixins } from "../utilities/index";
import { FormAssociatedSearch } from "./search.form-associated";
/**
 * A Search Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/search | <input type="search" /> element }.
 *
 * @public
 */
export class Search extends FormAssociatedSearch {
    readOnlyChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.readOnly = this.readOnly;
            this.validate();
        }
    }
    autofocusChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.autofocus = this.autofocus;
            this.validate();
        }
    }
    placeholderChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.placeholder = this.placeholder;
        }
    }
    listChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.setAttribute("list", this.list);
            this.validate();
        }
    }
    maxlengthChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.maxLength = this.maxlength;
            this.validate();
        }
    }
    minlengthChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.minLength = this.minlength;
            this.validate();
        }
    }
    patternChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.pattern = this.pattern;
            this.validate();
        }
    }
    sizeChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.size = this.size;
        }
    }
    spellcheckChanged() {
        if (this.proxy instanceof HTMLInputElement) {
            this.proxy.spellcheck = this.spellcheck;
        }
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.validate();
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
        this.value = this.control.value;
    }
    /**
     * Handles the control's clear value event
     * @public
     */
    handleClearInput() {
        this.value = "";
        this.control.focus();
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
}
__decorate([
    attr({ attribute: "readonly", mode: "boolean" })
], Search.prototype, "readOnly", void 0);
__decorate([
    attr({ mode: "boolean" })
], Search.prototype, "autofocus", void 0);
__decorate([
    attr
], Search.prototype, "placeholder", void 0);
__decorate([
    attr
], Search.prototype, "list", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], Search.prototype, "maxlength", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], Search.prototype, "minlength", void 0);
__decorate([
    attr
], Search.prototype, "pattern", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], Search.prototype, "size", void 0);
__decorate([
    attr({ mode: "boolean" })
], Search.prototype, "spellcheck", void 0);
__decorate([
    observable
], Search.prototype, "defaultSlottedNodes", void 0);
/**
 * Includes ARIA states and properties relating to the ARIA textbox role
 *
 * @public
 */
export class DelegatesARIASearch {
}
applyMixins(DelegatesARIASearch, ARIAGlobalStatesAndProperties);
applyMixins(Search, StartEnd, DelegatesARIASearch);
