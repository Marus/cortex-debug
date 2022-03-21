import { __decorate } from "tslib";
import { attr, DOM, nullableNumberConverter, observable } from "@microsoft/fast-element";
import { inRange, keyArrowDown, keyArrowUp, keyEnd, keyEscape, keyHome, keySpace, keyTab, } from "@microsoft/fast-web-utilities";
import { Listbox } from "./listbox";
/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria/#listbox | ARIA listbox }.
 *
 * @public
 */
export class ListboxElement extends Listbox {
    constructor() {
        super(...arguments);
        /**
         * The index of the most recently checked option.
         *
         * @internal
         * @remarks
         * Multiple-selection mode only.
         */
        this.activeIndex = -1;
        /**
         * The start index when checking a range of options.
         *
         * @internal
         */
        this.rangeStartIndex = -1;
    }
    /**
     * Returns the last checked option.
     *
     * @internal
     */
    get activeOption() {
        return this.options[this.activeIndex];
    }
    /**
     * Returns the list of checked options.
     *
     * @internal
     */
    get checkedOptions() {
        var _a;
        return (_a = this.options) === null || _a === void 0 ? void 0 : _a.filter(o => o.checked);
    }
    /**
     * Returns the index of the first selected option.
     *
     * @internal
     */
    get firstSelectedOptionIndex() {
        return this.options.indexOf(this.firstSelectedOption);
    }
    /**
     * Updates the `ariaActiveDescendant` property when the active index changes.
     *
     * @param prev - the previous active index
     * @param next - the next active index
     *
     * @internal
     */
    activeIndexChanged(prev, next) {
        var _a, _b;
        this.ariaActiveDescendant = (_b = (_a = this.options[next]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : "";
        this.focusAndScrollOptionIntoView();
    }
    /**
     * Toggles the checked state for the currently active option.
     *
     * @remarks
     * Multiple-selection mode only.
     *
     * @internal
     */
    checkActiveIndex() {
        if (!this.multiple) {
            return;
        }
        const activeItem = this.activeOption;
        if (activeItem) {
            activeItem.checked = true;
        }
    }
    /**
     * Sets the active index to the first option and marks it as checked.
     *
     * @remarks
     * Multi-selection mode only.
     *
     * @param preserveChecked - mark all options unchecked before changing the active index
     *
     * @internal
     */
    checkFirstOption(preserveChecked = false) {
        if (preserveChecked) {
            if (this.rangeStartIndex === -1) {
                this.rangeStartIndex = this.activeIndex + 1;
            }
            this.options.forEach((o, i) => {
                o.checked = inRange(i, this.rangeStartIndex);
            });
        }
        else {
            this.uncheckAllOptions();
        }
        this.activeIndex = 0;
        this.checkActiveIndex();
    }
    /**
     * Decrements the active index and sets the matching option as checked.
     *
     * @remarks
     * Multi-selection mode only.
     *
     * @param preserveChecked - mark all options unchecked before changing the active index
     *
     * @internal
     */
    checkLastOption(preserveChecked = false) {
        if (preserveChecked) {
            if (this.rangeStartIndex === -1) {
                this.rangeStartIndex = this.activeIndex;
            }
            this.options.forEach((o, i) => {
                o.checked = inRange(i, this.rangeStartIndex, this.options.length);
            });
        }
        else {
            this.uncheckAllOptions();
        }
        this.activeIndex = this.options.length - 1;
        this.checkActiveIndex();
    }
    /**
     * @override
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener("focusout", this.focusoutHandler);
    }
    /**
     * @override
     * @internal
     */
    disconnectedCallback() {
        this.removeEventListener("focusout", this.focusoutHandler);
        super.disconnectedCallback();
    }
    /**
     * Increments the active index and marks the matching option as checked.
     *
     * @remarks
     * Multiple-selection mode only.
     *
     * @param preserveChecked - mark all options unchecked before changing the active index
     *
     * @internal
     */
    checkNextOption(preserveChecked = false) {
        if (preserveChecked) {
            if (this.rangeStartIndex === -1) {
                this.rangeStartIndex = this.activeIndex;
            }
            this.options.forEach((o, i) => {
                o.checked = inRange(i, this.rangeStartIndex, this.activeIndex + 1);
            });
        }
        else {
            this.uncheckAllOptions();
        }
        this.activeIndex += this.activeIndex < this.options.length - 1 ? 1 : 0;
        this.checkActiveIndex();
    }
    /**
     * Decrements the active index and marks the matching option as checked.
     *
     * @remarks
     * Multiple-selection mode only.
     *
     * @param preserveChecked - mark all options unchecked before changing the active index
     *
     * @internal
     */
    checkPreviousOption(preserveChecked = false) {
        if (preserveChecked) {
            if (this.rangeStartIndex === -1) {
                this.rangeStartIndex = this.activeIndex;
            }
            if (this.checkedOptions.length === 1) {
                this.rangeStartIndex += 1;
            }
            this.options.forEach((o, i) => {
                o.checked = inRange(i, this.activeIndex, this.rangeStartIndex);
            });
        }
        else {
            this.uncheckAllOptions();
        }
        this.activeIndex -= this.activeIndex > 0 ? 1 : 0;
        this.checkActiveIndex();
    }
    /**
     * Handles click events for listbox options.
     *
     * @param e - the event object
     *
     * @override
     * @internal
     */
    clickHandler(e) {
        var _a;
        if (!this.multiple) {
            return super.clickHandler(e);
        }
        const captured = (_a = e.target) === null || _a === void 0 ? void 0 : _a.closest(`[role=option]`);
        if (!captured || captured.disabled) {
            return;
        }
        this.uncheckAllOptions();
        this.activeIndex = this.options.indexOf(captured);
        this.checkActiveIndex();
        this.toggleSelectedForAllCheckedOptions();
        return true;
    }
    /**
     * @override
     * @internal
     */
    focusAndScrollOptionIntoView() {
        super.focusAndScrollOptionIntoView(this.activeOption);
    }
    /**
     * In multiple-selection mode:
     * If any options are selected, the first selected option is checked when
     * the listbox receives focus. If no options are selected, the first
     * selectable option is checked.
     *
     * @override
     * @internal
     */
    focusinHandler(e) {
        if (!this.multiple) {
            return super.focusinHandler(e);
        }
        if (!this.shouldSkipFocus && e.target === e.currentTarget) {
            this.uncheckAllOptions();
            if (this.activeIndex === -1) {
                this.activeIndex =
                    this.firstSelectedOptionIndex !== -1
                        ? this.firstSelectedOptionIndex
                        : 0;
            }
            this.checkActiveIndex();
            this.setSelectedOptions();
            this.focusAndScrollOptionIntoView();
        }
        this.shouldSkipFocus = false;
    }
    /**
     * Unchecks all options when the listbox loses focus.
     *
     * @internal
     */
    focusoutHandler(e) {
        if (this.multiple) {
            this.uncheckAllOptions();
        }
    }
    /**
     * Handles keydown actions for listbox navigation and typeahead
     *
     * @override
     * @internal
     */
    keydownHandler(e) {
        if (!this.multiple) {
            return super.keydownHandler(e);
        }
        if (this.disabled) {
            return true;
        }
        const { key, shiftKey } = e;
        this.shouldSkipFocus = false;
        switch (key) {
            // Select the first available option
            case keyHome: {
                this.checkFirstOption(shiftKey);
                return;
            }
            // Select the next selectable option
            case keyArrowDown: {
                this.checkNextOption(shiftKey);
                return;
            }
            // Select the previous selectable option
            case keyArrowUp: {
                this.checkPreviousOption(shiftKey);
                return;
            }
            // Select the last available option
            case keyEnd: {
                this.checkLastOption(shiftKey);
                return;
            }
            case keyTab: {
                this.focusAndScrollOptionIntoView();
                return true;
            }
            case keyEscape: {
                if (this.multiple) {
                    this.uncheckAllOptions();
                    this.checkActiveIndex();
                }
                return true;
            }
            case keySpace: {
                e.preventDefault();
                if (this.typeAheadExpired) {
                    this.toggleSelectedForAllCheckedOptions();
                }
                return;
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
     * @override
     * @internal
     */
    mousedownHandler(e) {
        if (e.offsetX >= 0 && e.offsetX <= this.scrollWidth) {
            return super.mousedownHandler(e);
        }
    }
    /**
     * Switches between single-selection and multi-selection mode.
     *
     * @override
     * @internal
     */
    multipleChanged(prev, next) {
        var _a;
        super.multipleChanged(prev, next);
        (_a = this.options) === null || _a === void 0 ? void 0 : _a.forEach(o => {
            o.checked = next ? false : undefined;
        });
        this.setSelectedOptions();
        if (next && !this.size) {
            this.size = 0;
        }
    }
    /**
     * Sets an option as selected and gives it focus.
     *
     * @override
     * @public
     */
    setSelectedOptions() {
        if (!this.multiple) {
            super.setSelectedOptions();
            return;
        }
        if (this.$fastController.isConnected && this.options) {
            this.selectedOptions = this.options.filter(o => o.selected);
            this.focusAndScrollOptionIntoView();
        }
    }
    /**
     * Ensures the size is a positive integer when the property is updated.
     *
     * @param prev - the previous size value
     * @param next - the current size value
     *
     * @internal
     */
    sizeChanged(prev, next) {
        const size = Math.max(0, parseInt(next.toFixed(), 10));
        if (size !== next) {
            DOM.queueUpdate(() => {
                this.size = size;
            });
        }
    }
    /**
     * Toggles the selected state of the provided options. If any provided items
     * are in an unselected state, all items are set to selected. If every
     * provided item is selected, they are all unselected.
     *
     * @internal
     */
    toggleSelectedForAllCheckedOptions() {
        const enabledCheckedOptions = this.checkedOptions.filter(o => !o.disabled);
        const force = !enabledCheckedOptions.every(o => o.selected);
        enabledCheckedOptions.forEach(o => (o.selected = force));
        this.selectedIndex = this.options.indexOf(enabledCheckedOptions[enabledCheckedOptions.length - 1]);
        this.setSelectedOptions();
    }
    /**
     * @override
     * @internal
     */
    typeaheadBufferChanged(prev, next) {
        if (!this.multiple) {
            super.typeaheadBufferChanged(prev, next);
            return;
        }
        if (this.$fastController.isConnected) {
            const typeaheadMatches = this.getTypeaheadMatches();
            if (typeaheadMatches) {
                const activeIndex = this.options.indexOf(this.getTypeaheadMatches[0]);
                if (activeIndex > -1) {
                    this.activeIndex = activeIndex;
                    this.uncheckAllOptions();
                    this.checkActiveIndex();
                }
            }
            this.typeAheadExpired = false;
        }
    }
    /**
     * Unchecks all options.
     *
     * @remarks
     * Multiple-selection mode only.
     *
     * @param preserveChecked - reset the rangeStartIndex
     *
     * @internal
     */
    uncheckAllOptions(preserveChecked = false) {
        this.options.forEach(o => (o.checked = this.multiple ? false : undefined));
        if (!preserveChecked) {
            this.rangeStartIndex = -1;
        }
    }
}
__decorate([
    observable
], ListboxElement.prototype, "activeIndex", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], ListboxElement.prototype, "size", void 0);
