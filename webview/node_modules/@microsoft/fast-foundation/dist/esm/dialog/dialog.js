import { __decorate } from "tslib";
import { attr, DOM, Observable } from "@microsoft/fast-element";
import { keyEscape, keyTab } from "@microsoft/fast-web-utilities";
import { isTabbable } from "tabbable";
import { FoundationElement } from "../foundation-element";
/**
 * A Switch Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#dialog | ARIA dialog }.
 *
 * @public
 */
export class Dialog extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * Indicates the element is modal. When modal, user mouse interaction will be limited to the contents of the element by a modal
         * overlay.  Clicks on the overlay will cause the dialog to emit a "dismiss" event.
         * @public
         * @defaultValue - true
         * @remarks
         * HTML Attribute: modal
         */
        this.modal = true;
        /**
         * The hidden state of the element.
         *
         * @public
         * @defaultValue - false
         * @remarks
         * HTML Attribute: hidden
         */
        this.hidden = false;
        /**
         * Indicates that the dialog should trap focus.
         *
         * @public
         * @defaultValue - true
         * @remarks
         * HTML Attribute: trap-focus
         */
        this.trapFocus = true;
        this.trapFocusChanged = () => {
            if (this.$fastController.isConnected) {
                this.updateTrapFocus();
            }
        };
        /**
         * @internal
         */
        this.isTrappingFocus = false;
        this.handleDocumentKeydown = (e) => {
            if (!e.defaultPrevented && !this.hidden) {
                switch (e.key) {
                    case keyEscape:
                        this.dismiss();
                        e.preventDefault();
                        break;
                    case keyTab:
                        this.handleTabKeyDown(e);
                        break;
                }
            }
        };
        this.handleDocumentFocus = (e) => {
            if (!e.defaultPrevented && this.shouldForceFocus(e.target)) {
                this.focusFirstElement();
                e.preventDefault();
            }
        };
        this.handleTabKeyDown = (e) => {
            if (!this.trapFocus || this.hidden) {
                return;
            }
            const bounds = this.getTabQueueBounds();
            if (bounds.length === 0) {
                return;
            }
            if (bounds.length === 1) {
                // keep focus on single element
                bounds[0].focus();
                e.preventDefault();
                return;
            }
            if (e.shiftKey && e.target === bounds[0]) {
                bounds[bounds.length - 1].focus();
                e.preventDefault();
            }
            else if (!e.shiftKey && e.target === bounds[bounds.length - 1]) {
                bounds[0].focus();
                e.preventDefault();
            }
            return;
        };
        this.getTabQueueBounds = () => {
            const bounds = [];
            return Dialog.reduceTabbableItems(bounds, this);
        };
        /**
         * focus on first element of tab queue
         */
        this.focusFirstElement = () => {
            const bounds = this.getTabQueueBounds();
            if (bounds.length > 0) {
                bounds[0].focus();
            }
            else {
                if (this.dialog instanceof HTMLElement) {
                    this.dialog.focus();
                }
            }
        };
        /**
         * we should only focus if focus has not already been brought to the dialog
         */
        this.shouldForceFocus = (currentFocusElement) => {
            return this.isTrappingFocus && !this.contains(currentFocusElement);
        };
        /**
         * we should we be active trapping focus
         */
        this.shouldTrapFocus = () => {
            return this.trapFocus && !this.hidden;
        };
        /**
         *
         *
         * @internal
         */
        this.updateTrapFocus = (shouldTrapFocusOverride) => {
            const shouldTrapFocus = shouldTrapFocusOverride === undefined
                ? this.shouldTrapFocus()
                : shouldTrapFocusOverride;
            if (shouldTrapFocus && !this.isTrappingFocus) {
                this.isTrappingFocus = true;
                // Add an event listener for focusin events if we are trapping focus
                document.addEventListener("focusin", this.handleDocumentFocus);
                DOM.queueUpdate(() => {
                    if (this.shouldForceFocus(document.activeElement)) {
                        this.focusFirstElement();
                    }
                });
            }
            else if (!shouldTrapFocus && this.isTrappingFocus) {
                this.isTrappingFocus = false;
                // remove event listener if we are not trapping focus
                document.removeEventListener("focusin", this.handleDocumentFocus);
            }
        };
    }
    /**
     * @internal
     */
    dismiss() {
        this.$emit("dismiss");
    }
    /**
     * The method to show the dialog.
     *
     * @public
     */
    show() {
        this.hidden = false;
    }
    /**
     * The method to hide the dialog.
     *
     * @public
     */
    hide() {
        this.hidden = true;
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("keydown", this.handleDocumentKeydown);
        this.notifier = Observable.getNotifier(this);
        this.notifier.subscribe(this, "hidden");
        this.updateTrapFocus();
    }
    /**
     * @internal
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        // remove keydown event listener
        document.removeEventListener("keydown", this.handleDocumentKeydown);
        // if we are trapping focus remove the focusin listener
        this.updateTrapFocus(false);
        this.notifier.unsubscribe(this, "hidden");
    }
    /**
     * @internal
     */
    handleChange(source, propertyName) {
        switch (propertyName) {
            case "hidden":
                this.updateTrapFocus();
                break;
            default:
                break;
        }
    }
    /**
     * Reduce a collection to only its focusable elements.
     *
     * @param elements - Collection of elements to reduce
     * @param element - The current element
     *
     * @internal
     */
    static reduceTabbableItems(elements, element) {
        if (element.getAttribute("tabindex") === "-1") {
            return elements;
        }
        if (isTabbable(element) ||
            (Dialog.isFocusableFastElement(element) && Dialog.hasTabbableShadow(element))) {
            elements.push(element);
            return elements;
        }
        if (element.childElementCount) {
            return elements.concat(Array.from(element.children).reduce(Dialog.reduceTabbableItems, []));
        }
        return elements;
    }
    /**
     * Test if element is focusable fast element
     *
     * @param element - The element to check
     *
     * @internal
     */
    static isFocusableFastElement(element) {
        var _a, _b;
        return !!((_b = (_a = element.$fastController) === null || _a === void 0 ? void 0 : _a.definition.shadowOptions) === null || _b === void 0 ? void 0 : _b.delegatesFocus);
    }
    /**
     * Test if the element has a focusable shadow
     *
     * @param element - The element to check
     *
     * @internal
     */
    static hasTabbableShadow(element) {
        var _a, _b;
        return Array.from((_b = (_a = element.shadowRoot) === null || _a === void 0 ? void 0 : _a.querySelectorAll("*")) !== null && _b !== void 0 ? _b : []).some(x => {
            return isTabbable(x);
        });
    }
}
__decorate([
    attr({ mode: "boolean" })
], Dialog.prototype, "modal", void 0);
__decorate([
    attr({ mode: "boolean" })
], Dialog.prototype, "hidden", void 0);
__decorate([
    attr({ attribute: "trap-focus", mode: "boolean" })
], Dialog.prototype, "trapFocus", void 0);
__decorate([
    attr({ attribute: "aria-describedby" })
], Dialog.prototype, "ariaDescribedby", void 0);
__decorate([
    attr({ attribute: "aria-labelledby" })
], Dialog.prototype, "ariaLabelledby", void 0);
__decorate([
    attr({ attribute: "aria-label" })
], Dialog.prototype, "ariaLabel", void 0);
