import { __decorate } from "tslib";
import { attr, observable, Observable } from "@microsoft/fast-element";
import { findLastIndex, keyArrowDown, keyArrowUp, keyEnd, keyEnter, keyEscape, keyHome, keySpace, keyTab, uniqueId, } from "@microsoft/fast-web-utilities";
import { FoundationElement } from "../foundation-element";
import { isListboxOption } from "../listbox-option/listbox-option";
import { ARIAGlobalStatesAndProperties } from "../patterns/aria-global";
import { applyMixins } from "../utilities/apply-mixins";
/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#listbox | ARIA listbox }.
 *
 * @public
 */
export class Listbox extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * The internal unfiltered list of selectable options.
         *
         * @internal
         */
        this._options = [];
        /**
         * The index of the selected option.
         *
         * @public
         */
        this.selectedIndex = -1;
        /**
         * A collection of the selected options.
         *
         * @public
         */
        this.selectedOptions = [];
        /**
         * A standard `click` event creates a `focus` event before firing, so a
         * `mousedown` event is used to skip that initial focus.
         *
         * @internal
         */
        this.shouldSkipFocus = false;
        /**
         * The current typeahead buffer string.
         *
         * @internal
         */
        this.typeaheadBuffer = "";
        /**
         * Flag for the typeahead timeout expiration.
         *
         * @internal
         */
        this.typeaheadExpired = true;
        /**
         * The timeout ID for the typeahead handler.
         *
         * @internal
         */
        this.typeaheadTimeout = -1;
    }
    /**
     * The first selected option.
     *
     * @internal
     */
    get firstSelectedOption() {
        var _a;
        return (_a = this.selectedOptions[0]) !== null && _a !== void 0 ? _a : null;
    }
    /**
     * Returns true if there is one or more selectable option.
     *
     * @internal
     */
    get hasSelectableOptions() {
        return this.options.length > 0 && !this.options.every(o => o.disabled);
    }
    /**
     * The number of options.
     *
     * @public
     */
    get length() {
        var _a, _b;
        return (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    }
    /**
     * The list of options.
     *
     * @public
     */
    get options() {
        Observable.track(this, "options");
        return this._options;
    }
    set options(value) {
        this._options = value;
        Observable.notify(this, "options");
    }
    /**
     * Flag for the typeahead timeout expiration.
     *
     * @deprecated use `Listbox.typeaheadExpired`
     * @internal
     */
    get typeAheadExpired() {
        return this.typeaheadExpired;
    }
    set typeAheadExpired(value) {
        this.typeaheadExpired = value;
    }
    /**
     * Handle click events for listbox options.
     *
     * @internal
     */
    clickHandler(e) {
        const captured = e.target.closest(`option,[role=option]`);
        if (captured && !captured.disabled) {
            this.selectedIndex = this.options.indexOf(captured);
            return true;
        }
    }
    /**
     * Ensures that the provided option is focused and scrolled into view.
     *
     * @param optionToFocus - The option to focus
     * @internal
     */
    focusAndScrollOptionIntoView(optionToFocus = this.firstSelectedOption) {
        // To ensure that the browser handles both `focus()` and `scrollIntoView()`, the
        // timing here needs to guarantee that they happen on different frames. Since this
        // function is typically called from the `openChanged` observer, `DOM.queueUpdate`
        // causes the calls to be grouped into the same frame. To prevent this,
        // `requestAnimationFrame` is used instead of `DOM.queueUpdate`.
        if (this.contains(document.activeElement) && optionToFocus !== null) {
            optionToFocus.focus();
            requestAnimationFrame(() => {
                optionToFocus.scrollIntoView({ block: "nearest" });
            });
        }
    }
    /**
     * Handles `focusin` actions for the component. When the component receives focus,
     * the list of selected options is refreshed and the first selected option is scrolled
     * into view.
     *
     * @internal
     */
    focusinHandler(e) {
        if (!this.shouldSkipFocus && e.target === e.currentTarget) {
            this.setSelectedOptions();
            this.focusAndScrollOptionIntoView();
        }
        this.shouldSkipFocus = false;
    }
    /**
     * Returns the options which match the current typeahead buffer.
     *
     * @internal
     */
    getTypeaheadMatches() {
        const pattern = this.typeaheadBuffer.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`^${pattern}`, "gi");
        return this.options.filter((o) => o.text.trim().match(re));
    }
    /**
     * Determines the index of the next option which is selectable, if any.
     *
     * @param prev - the previous selected index
     * @param next - the next index to select
     *
     * @internal
     */
    getSelectableIndex(prev = this.selectedIndex, next) {
        const direction = prev > next ? -1 : prev < next ? 1 : 0;
        const potentialDirection = prev + direction;
        let nextSelectableOption = null;
        switch (direction) {
            case -1: {
                nextSelectableOption = this.options.reduceRight((nextSelectableOption, thisOption, index) => !nextSelectableOption &&
                    !thisOption.disabled &&
                    index < potentialDirection
                    ? thisOption
                    : nextSelectableOption, nextSelectableOption);
                break;
            }
            case 1: {
                nextSelectableOption = this.options.reduce((nextSelectableOption, thisOption, index) => !nextSelectableOption &&
                    !thisOption.disabled &&
                    index > potentialDirection
                    ? thisOption
                    : nextSelectableOption, nextSelectableOption);
                break;
            }
        }
        return this.options.indexOf(nextSelectableOption);
    }
    /**
     * Handles external changes to child options.
     *
     * @param source - the source object
     * @param propertyName - the property
     *
     * @internal
     */
    handleChange(source, propertyName) {
        switch (propertyName) {
            case "selected": {
                if (Listbox.slottedOptionFilter(source)) {
                    this.selectedIndex = this.options.indexOf(source);
                }
                this.setSelectedOptions();
                break;
            }
        }
    }
    /**
     * Moves focus to an option whose label matches characters typed by the user.
     * Consecutive keystrokes are batched into a buffer of search text used
     * to match against the set of options.  If `TYPE_AHEAD_TIMEOUT_MS` passes
     * between consecutive keystrokes, the search restarts.
     *
     * @param key - the key to be evaluated
     *
     * @internal
     */
    handleTypeAhead(key) {
        if (this.typeaheadTimeout) {
            window.clearTimeout(this.typeaheadTimeout);
        }
        this.typeaheadTimeout = window.setTimeout(() => (this.typeaheadExpired = true), Listbox.TYPE_AHEAD_TIMEOUT_MS);
        if (key.length > 1) {
            return;
        }
        this.typeaheadBuffer = `${this.typeaheadExpired ? "" : this.typeaheadBuffer}${key}`;
    }
    /**
     * Handles `keydown` actions for listbox navigation and typeahead.
     *
     * @internal
     */
    keydownHandler(e) {
        if (this.disabled) {
            return true;
        }
        this.shouldSkipFocus = false;
        const key = e.key;
        switch (key) {
            // Select the first available option
            case keyHome: {
                if (!e.shiftKey) {
                    e.preventDefault();
                    this.selectFirstOption();
                }
                break;
            }
            // Select the next selectable option
            case keyArrowDown: {
                if (!e.shiftKey) {
                    e.preventDefault();
                    this.selectNextOption();
                }
                break;
            }
            // Select the previous selectable option
            case keyArrowUp: {
                if (!e.shiftKey) {
                    e.preventDefault();
                    this.selectPreviousOption();
                }
                break;
            }
            // Select the last available option
            case keyEnd: {
                e.preventDefault();
                this.selectLastOption();
                break;
            }
            case keyTab: {
                this.focusAndScrollOptionIntoView();
                return true;
            }
            case keyEnter:
            case keyEscape: {
                return true;
            }
            case keySpace: {
                if (this.typeaheadExpired) {
                    return true;
                }
            }
            // Send key to Typeahead handler
            default: {
                if (key.length === 1) {
                    this.handleTypeAhead(`${key}`);
                }
                return true;
            }
        }
    }
    /**
     * Prevents `focusin` events from firing before `click` events when the
     * element is unfocused.
     *
     * @internal
     */
    mousedownHandler(e) {
        this.shouldSkipFocus = !this.contains(document.activeElement);
        return true;
    }
    /**
     * Switches between single-selection and multi-selection mode.
     *
     * @param prev - the previous value of the `multiple` attribute
     * @param next - the next value of the `multiple` attribute
     *
     * @internal
     */
    multipleChanged(prev, next) {
        this.ariaMultiSelectable = next ? "true" : undefined;
    }
    /**
     * Updates the list of selected options when the `selectedIndex` changes.
     *
     * @param prev - the previous selected index value
     * @param next - the current selected index value
     *
     * @internal
     */
    selectedIndexChanged(prev, next) {
        var _a;
        if (!this.hasSelectableOptions) {
            this.selectedIndex = -1;
            return;
        }
        if (((_a = this.options[this.selectedIndex]) === null || _a === void 0 ? void 0 : _a.disabled) && typeof prev === "number") {
            const selectableIndex = this.getSelectableIndex(prev, next);
            const newNext = selectableIndex > -1 ? selectableIndex : prev;
            this.selectedIndex = newNext;
            if (next === newNext) {
                this.selectedIndexChanged(next, newNext);
            }
            return;
        }
        this.setSelectedOptions();
    }
    /**
     * Updates the selectedness of each option when the list of selected options changes.
     *
     * @param prev - the previous list of selected options
     * @param next - the current list of selected options
     *
     * @internal
     */
    selectedOptionsChanged(prev, next) {
        var _a;
        const filteredNext = next.filter(Listbox.slottedOptionFilter);
        (_a = this.options) === null || _a === void 0 ? void 0 : _a.forEach(o => {
            const notifier = Observable.getNotifier(o);
            notifier.unsubscribe(this, "selected");
            o.selected = filteredNext.includes(o);
            notifier.subscribe(this, "selected");
        });
    }
    /**
     * Moves focus to the first selectable option.
     *
     * @public
     */
    selectFirstOption() {
        var _a, _b;
        if (!this.disabled) {
            this.selectedIndex = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex(o => !o.disabled)) !== null && _b !== void 0 ? _b : -1;
        }
    }
    /**
     * Moves focus to the last selectable option.
     *
     * @internal
     */
    selectLastOption() {
        if (!this.disabled) {
            this.selectedIndex = findLastIndex(this.options, o => !o.disabled);
        }
    }
    /**
     * Moves focus to the next selectable option.
     *
     * @internal
     */
    selectNextOption() {
        if (!this.disabled && this.selectedIndex < this.options.length - 1) {
            this.selectedIndex += 1;
        }
    }
    /**
     * Moves focus to the previous selectable option.
     *
     * @internal
     */
    selectPreviousOption() {
        if (!this.disabled && this.selectedIndex > 0) {
            this.selectedIndex = this.selectedIndex - 1;
        }
    }
    /**
     * Updates the selected index to match the first selected option.
     *
     * @internal
     */
    setDefaultSelectedOption() {
        var _a, _b;
        this.selectedIndex = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex(el => el.defaultSelected)) !== null && _b !== void 0 ? _b : -1;
    }
    /**
     * Sets an option as selected and gives it focus.
     *
     * @public
     */
    setSelectedOptions() {
        var _a, _b, _c;
        if ((_a = this.options) === null || _a === void 0 ? void 0 : _a.length) {
            this.selectedOptions = [this.options[this.selectedIndex]];
            this.ariaActiveDescendant = (_c = (_b = this.firstSelectedOption) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : "";
            this.focusAndScrollOptionIntoView();
        }
    }
    /**
     * Updates the list of options and resets the selected option when the slotted option content changes.
     *
     * @param prev - the previous list of slotted options
     * @param next - the current list of slotted options
     *
     * @internal
     */
    slottedOptionsChanged(prev, next) {
        this.options = next.reduce((options, item) => {
            if (isListboxOption(item)) {
                options.push(item);
            }
            return options;
        }, []);
        const setSize = `${this.options.length}`;
        this.options.forEach((option, index) => {
            if (!option.id) {
                option.id = uniqueId("option-");
            }
            option.ariaPosInSet = `${index + 1}`;
            option.ariaSetSize = setSize;
        });
        if (this.$fastController.isConnected) {
            this.setSelectedOptions();
            this.setDefaultSelectedOption();
        }
    }
    /**
     * Updates the filtered list of options when the typeahead buffer changes.
     *
     * @param prev - the previous typeahead buffer value
     * @param next - the current typeahead buffer value
     *
     * @internal
     */
    typeaheadBufferChanged(prev, next) {
        if (this.$fastController.isConnected) {
            const typeaheadMatches = this.getTypeaheadMatches();
            if (typeaheadMatches.length) {
                const selectedIndex = this.options.indexOf(typeaheadMatches[0]);
                if (selectedIndex > -1) {
                    this.selectedIndex = selectedIndex;
                }
            }
            this.typeaheadExpired = false;
        }
    }
}
/**
 * A static filter to include only selectable options.
 *
 * @param n - element to filter
 * @public
 */
Listbox.slottedOptionFilter = (n) => isListboxOption(n) && !n.disabled && !n.hidden;
/**
 * Typeahead timeout in milliseconds.
 *
 * @internal
 */
Listbox.TYPE_AHEAD_TIMEOUT_MS = 1000;
__decorate([
    attr({ mode: "boolean" })
], Listbox.prototype, "disabled", void 0);
__decorate([
    attr({ mode: "boolean" })
], Listbox.prototype, "multiple", void 0);
__decorate([
    observable
], Listbox.prototype, "selectedIndex", void 0);
__decorate([
    observable
], Listbox.prototype, "selectedOptions", void 0);
__decorate([
    observable
], Listbox.prototype, "slottedOptions", void 0);
__decorate([
    observable
], Listbox.prototype, "typeaheadBuffer", void 0);
/**
 * Includes ARIA states and properties relating to the ARIA listbox role
 *
 * @public
 */
export class DelegatesARIAListbox {
}
__decorate([
    observable
], DelegatesARIAListbox.prototype, "ariaActiveDescendant", void 0);
__decorate([
    observable
], DelegatesARIAListbox.prototype, "ariaDisabled", void 0);
__decorate([
    observable
], DelegatesARIAListbox.prototype, "ariaExpanded", void 0);
__decorate([
    observable
], DelegatesARIAListbox.prototype, "ariaMultiSelectable", void 0);
applyMixins(DelegatesARIAListbox, ARIAGlobalStatesAndProperties);
applyMixins(Listbox, DelegatesARIAListbox);
