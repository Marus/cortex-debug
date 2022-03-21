import type { ListboxOption } from "../listbox-option/listbox-option";
import { Listbox } from "./listbox";
/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria/#listbox | ARIA listbox }.
 *
 * @public
 */
export declare class ListboxElement extends Listbox {
    /**
     * The index of the most recently checked option.
     *
     * @internal
     * @remarks
     * Multiple-selection mode only.
     */
    protected activeIndex: number;
    /**
     * Returns the last checked option.
     *
     * @internal
     */
    get activeOption(): ListboxOption | null;
    /**
     * Returns the list of checked options.
     *
     * @internal
     */
    protected get checkedOptions(): ListboxOption[];
    /**
     * Returns the index of the first selected option.
     *
     * @internal
     */
    get firstSelectedOptionIndex(): number;
    /**
     * The start index when checking a range of options.
     *
     * @internal
     */
    protected rangeStartIndex: number;
    /**
     * The maximum number of options to display.
     *
     * @remarks
     * HTML Attribute: `size`.
     *
     * @public
     */
    size: number;
    /**
     * Updates the `ariaActiveDescendant` property when the active index changes.
     *
     * @param prev - the previous active index
     * @param next - the next active index
     *
     * @internal
     */
    protected activeIndexChanged(prev: number | undefined, next: number): void;
    /**
     * Toggles the checked state for the currently active option.
     *
     * @remarks
     * Multiple-selection mode only.
     *
     * @internal
     */
    protected checkActiveIndex(): void;
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
    protected checkFirstOption(preserveChecked?: boolean): void;
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
    protected checkLastOption(preserveChecked?: boolean): void;
    /**
     * @override
     * @internal
     */
    connectedCallback(): void;
    /**
     * @override
     * @internal
     */
    disconnectedCallback(): void;
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
    protected checkNextOption(preserveChecked?: boolean): void;
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
    protected checkPreviousOption(preserveChecked?: boolean): void;
    /**
     * Handles click events for listbox options.
     *
     * @param e - the event object
     *
     * @override
     * @internal
     */
    clickHandler(e: MouseEvent): boolean | void;
    /**
     * @override
     * @internal
     */
    protected focusAndScrollOptionIntoView(): void;
    /**
     * In multiple-selection mode:
     * If any options are selected, the first selected option is checked when
     * the listbox receives focus. If no options are selected, the first
     * selectable option is checked.
     *
     * @override
     * @internal
     */
    focusinHandler(e: FocusEvent): boolean | void;
    /**
     * Unchecks all options when the listbox loses focus.
     *
     * @internal
     */
    focusoutHandler(e: FocusEvent): void;
    /**
     * Handles keydown actions for listbox navigation and typeahead
     *
     * @override
     * @internal
     */
    keydownHandler(e: KeyboardEvent): boolean | void;
    /**
     * Prevents `focusin` events from firing before `click` events when the
     * element is unfocused.
     *
     * @override
     * @internal
     */
    mousedownHandler(e: MouseEvent): boolean | void;
    /**
     * Switches between single-selection and multi-selection mode.
     *
     * @override
     * @internal
     */
    multipleChanged(prev: boolean | undefined, next: boolean): void;
    /**
     * Sets an option as selected and gives it focus.
     *
     * @override
     * @public
     */
    protected setSelectedOptions(): void;
    /**
     * Ensures the size is a positive integer when the property is updated.
     *
     * @param prev - the previous size value
     * @param next - the current size value
     *
     * @internal
     */
    protected sizeChanged(prev: number | unknown, next: number): void;
    /**
     * Toggles the selected state of the provided options. If any provided items
     * are in an unselected state, all items are set to selected. If every
     * provided item is selected, they are all unselected.
     *
     * @internal
     */
    toggleSelectedForAllCheckedOptions(): void;
    /**
     * @override
     * @internal
     */
    typeaheadBufferChanged(prev: string, next: string): void;
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
    protected uncheckAllOptions(preserveChecked?: boolean): void;
}
