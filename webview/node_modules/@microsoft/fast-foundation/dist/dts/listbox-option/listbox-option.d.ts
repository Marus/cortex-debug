import { FoundationElement } from "../foundation-element";
import type { FoundationElementDefinition } from "../foundation-element";
import { ARIAGlobalStatesAndProperties } from "../patterns";
import { StartEnd } from "../patterns/start-end";
import type { StartEndOptions } from "../patterns/start-end";
/**
 * Listbox option configuration options
 * @public
 */
export declare type ListboxOptionOptions = FoundationElementDefinition & StartEndOptions;
/**
 * Determines if the element is a {@link (ListboxOption:class)}
 *
 * @param element - the element to test.
 * @public
 */
export declare function isListboxOption(el: Element): el is ListboxOption;
/**
 * An Option Custom HTML Element.
 * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#option | ARIA option }.
 *
 * @public
 */
export declare class ListboxOption extends FoundationElement {
    /**
     * @internal
     */
    private _value;
    /**
     * @internal
     */
    proxy: HTMLOptionElement;
    /**
     * The checked state is used when the parent listbox is in multiple selection mode.
     * To avoid accessibility conflicts, the checked state should not be present in
     * single selection mode.
     *
     * @public
     */
    checked?: boolean;
    /**
     * Updates the ariaChecked property when the checked property changes.
     *
     * @param prev - the previous checked value
     * @param next - the current checked value
     *
     * @public
     */
    protected checkedChanged(prev: boolean | unknown, next?: boolean): void;
    /**
     * The defaultSelected state of the option.
     * @public
     */
    defaultSelected: boolean;
    protected defaultSelectedChanged(): void;
    /**
     * Tracks whether the "selected" property has been changed.
     * @internal
     */
    private dirtySelected;
    /**
     * The disabled state of the option.
     * @public
     * @remarks
     * HTML Attribute: disabled
     */
    disabled: boolean;
    protected disabledChanged(prev: boolean, next: boolean): void;
    /**
     * The selected attribute value. This sets the initial selected value.
     *
     * @public
     * @remarks
     * HTML Attribute: selected
     */
    selectedAttribute: boolean;
    protected selectedAttributeChanged(): void;
    /**
     * The checked state of the control.
     *
     * @public
     */
    selected: boolean;
    protected selectedChanged(): void;
    /**
     * Track whether the value has been changed from the initial value
     */
    dirtyValue: boolean;
    /**
     * The initial value of the option. This value sets the `value` property
     * only when the `value` property has not been explicitly set.
     *
     * @remarks
     * HTML Attribute: value
     */
    protected initialValue: string;
    initialValueChanged(previous: string, next: string): void;
    get label(): string;
    get text(): string;
    set value(next: string);
    get value(): string;
    get form(): HTMLFormElement | null;
    constructor(text?: string, value?: string, defaultSelected?: boolean, selected?: boolean);
}
/**
 * States and properties relating to the ARIA `option` role.
 *
 * @public
 */
export declare class DelegatesARIAListboxOption {
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#option} for more information.
     * @public
     * @remarks
     * HTML Attribute: `aria-checked`
     */
    ariaChecked: "true" | "false" | undefined;
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#option} for more information.
     * @public
     * @remarks
     * HTML Attribute: `aria-posinset`
     */
    ariaPosInSet: string;
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#option} for more information.
     * @public
     * @remarks
     * HTML Attribute: `aria-selected`
     */
    ariaSelected: "true" | "false" | undefined;
    /**
     * See {@link https://www.w3.org/TR/wai-aria-1.2/#option} for more information.
     * @public
     * @remarks
     * HTML Attribute: `aria-setsize`
     */
    ariaSetSize: string;
}
/**
 * @internal
 * @privateRemarks
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 */
export interface DelegatesARIAListboxOption extends ARIAGlobalStatesAndProperties {
}
/**
 * @internal
 * @privateRemarks
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 */
export interface ListboxOption extends StartEnd, DelegatesARIAListboxOption {
}
