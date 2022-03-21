import { FoundationElement } from "../foundation-element";
import { ListboxOption } from "../listbox-option/listbox-option";
import { ARIAGlobalStatesAndProperties } from "../patterns/aria-global";
/**
 * A Listbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#listbox | ARIA listbox }.
 *
 * @public
 */
export declare abstract class Listbox extends FoundationElement {
    /**
     * The internal unfiltered list of selectable options.
     *
     * @internal
     */
    protected _options: ListboxOption[];
    /**
     * The first selected option.
     *
     * @internal
     */
    get firstSelectedOption(): ListboxOption;
    /**
     * Returns true if there is one or more selectable option.
     *
     * @internal
     */
    protected get hasSelectableOptions(): boolean;
    /**
     * The number of options.
     *
     * @public
     */
    get length(): number;
    /**
     * The list of options.
     *
     * @public
     */
    get options(): ListboxOption[];
    set options(value: ListboxOption[]);
    /**
     * Flag for the typeahead timeout expiration.
     *
     * @deprecated use `Listbox.typeaheadExpired`
     * @internal
     */
    protected get typeAheadExpired(): boolean;
    protected set typeAheadExpired(value: boolean);
    /**
     * The disabled state of the listbox.
     *
     * @public
     * @remarks
     * HTML Attribute: `disabled`
     */
    disabled: boolean;
    /**
     * Indicates if the listbox is in multi-selection mode.
     *
     * @remarks
     * HTML Attribute: `multiple`
     *
     * @public
     */
    multiple: boolean;
    /**
     * The index of the selected option.
     *
     * @public
     */
    selectedIndex: number;
    /**
     * A collection of the selected options.
     *
     * @public
     */
    selectedOptions: ListboxOption[];
    /**
     * A standard `click` event creates a `focus` event before firing, so a
     * `mousedown` event is used to skip that initial focus.
     *
     * @internal
     */
    protected shouldSkipFocus: boolean;
    /**
     * A static filter to include only selectable options.
     *
     * @param n - element to filter
     * @public
     */
    static slottedOptionFilter: (n: HTMLElement) => boolean;
    /**
     * The default slotted elements.
     *
     * @internal
     */
    slottedOptions: Element[];
    /**
     * Typeahead timeout in milliseconds.
     *
     * @internal
     */
    protected static readonly TYPE_AHEAD_TIMEOUT_MS = 1000;
    /**
     * The current typeahead buffer string.
     *
     * @internal
     */
    protected typeaheadBuffer: string;
    /**
     * Flag for the typeahead timeout expiration.
     *
     * @internal
     */
    protected typeaheadExpired: boolean;
    /**
     * The timeout ID for the typeahead handler.
     *
     * @internal
     */
    protected typeaheadTimeout: number;
    /**
     * Handle click events for listbox options.
     *
     * @internal
     */
    clickHandler(e: MouseEvent): boolean | void;
    /**
     * Ensures that the provided option is focused and scrolled into view.
     *
     * @param optionToFocus - The option to focus
     * @internal
     */
    protected focusAndScrollOptionIntoView(optionToFocus?: ListboxOption | null): void;
    /**
     * Handles `focusin` actions for the component. When the component receives focus,
     * the list of selected options is refreshed and the first selected option is scrolled
     * into view.
     *
     * @internal
     */
    focusinHandler(e: FocusEvent): void;
    /**
     * Returns the options which match the current typeahead buffer.
     *
     * @internal
     */
    protected getTypeaheadMatches(): ListboxOption[];
    /**
     * Determines the index of the next option which is selectable, if any.
     *
     * @param prev - the previous selected index
     * @param next - the next index to select
     *
     * @internal
     */
    protected getSelectableIndex(prev: number | undefined, next: number): number;
    /**
     * Handles external changes to child options.
     *
     * @param source - the source object
     * @param propertyName - the property
     *
     * @internal
     */
    handleChange(source: any, propertyName: string): void;
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
    handleTypeAhead(key: string): void;
    /**
     * Handles `keydown` actions for listbox navigation and typeahead.
     *
     * @internal
     */
    keydownHandler(e: KeyboardEvent): boolean | void;
    /**
     * Prevents `focusin` events from firing before `click` events when the
     * element is unfocused.
     *
     * @internal
     */
    mousedownHandler(e: MouseEvent): boolean | void;
    /**
     * Switches between single-selection and multi-selection mode.
     *
     * @param prev - the previous value of the `multiple` attribute
     * @param next - the next value of the `multiple` attribute
     *
     * @internal
     */
    multipleChanged(prev: boolean | undefined, next: boolean): void;
    /**
     * Updates the list of selected options when the `selectedIndex` changes.
     *
     * @param prev - the previous selected index value
     * @param next - the current selected index value
     *
     * @internal
     */
    selectedIndexChanged(prev: number | undefined, next: number): void;
    /**
     * Updates the selectedness of each option when the list of selected options changes.
     *
     * @param prev - the previous list of selected options
     * @param next - the current list of selected options
     *
     * @internal
     */
    protected selectedOptionsChanged(prev: ListboxOption[] | undefined, next: ListboxOption[]): void;
    /**
     * Moves focus to the first selectable option.
     *
     * @public
     */
    selectFirstOption(): void;
    /**
     * Moves focus to the last selectable option.
     *
     * @internal
     */
    selectLastOption(): void;
    /**
     * Moves focus to the next selectable option.
     *
     * @internal
     */
    selectNextOption(): void;
    /**
     * Moves focus to the previous selectable option.
     *
     * @internal
     */
    selectPreviousOption(): void;
    /**
     * Updates the selected index to match the first selected option.
     *
     * @internal
     */
    protected setDefaultSelectedOption(): void;
    /**
     * Sets an option as selected and gives it focus.
     *
     * @public
     */
    protected setSelectedOptions(): void;
    /**
     * Updates the list of options and resets the selected option when the slotted option content changes.
     *
     * @param prev - the previous list of slotted options
     * @param next - the current list of slotted options
     *
     * @internal
     */
    slottedOptionsChanged(prev: Element[] | undefined, next: Element[]): void;
    /**
     * Updates the filtered list of options when the typeahead buffer changes.
     *
     * @param prev - the previous typeahead buffer value
     * @param next - the current typeahead buffer value
     *
     * @internal
     */
    typeaheadBufferChanged(prev: string, next: string): void;
}
/**
 * Includes ARIA states and properties relating to the ARIA listbox role
 *
 * @public
 */
export declare class DelegatesARIAListbox {
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#listbox} for more information
     * @public
     * @remarks
     * HTML Attribute: `aria-activedescendant`
     */
    ariaActiveDescendant: string;
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#listbox} for more information
     * @public
     * @remarks
     * HTML Attribute: `aria-disabled`
     */
    ariaDisabled: "true" | "false";
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#listbox} for more information
     * @public
     * @remarks
     * HTML Attribute: `aria-expanded`
     */
    ariaExpanded: "true" | "false" | undefined;
    /**
     * See {@link https://w3c.github.io/aria/#listbox} for more information
     * @public
     * @remarks
     * HTML Attribute: `aria-multiselectable`
     */
    ariaMultiSelectable: "true" | "false" | undefined;
}
/**
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 * @internal
 */
export interface DelegatesARIAListbox extends ARIAGlobalStatesAndProperties {
}
/**
 * @internal
 */
export interface Listbox extends DelegatesARIAListbox {
}
