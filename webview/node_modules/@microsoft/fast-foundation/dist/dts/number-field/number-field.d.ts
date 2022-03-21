import { SyntheticViewTemplate } from "@microsoft/fast-element";
import { StartEnd, StartEndOptions } from "../patterns/index";
import type { FoundationElementDefinition } from "../foundation-element";
import { DelegatesARIATextbox } from "../text-field/index";
import { FormAssociatedNumberField } from "./number-field.form-associated";
/**
 * Number Field configuration options
 * @public
 */
export declare type NumberFieldOptions = FoundationElementDefinition & StartEndOptions & {
    stepDownGlyph?: string | SyntheticViewTemplate;
    stepUpGlyph?: string | SyntheticViewTemplate;
};
/**
 * A Number Field Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/number | <input type="number" /> element }.
 *
 * @public
 */
export declare class NumberField extends FormAssociatedNumberField {
    /**
     * When true, the control will be immutable by user interaction. See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/readonly | readonly HTML attribute} for more information.
     * @public
     * @remarks
     * HTML Attribute: readonly
     */
    readOnly: boolean;
    /**
     * Indicates that this element should get focus after the page finishes loading. See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#htmlattrdefautofocus | autofocus HTML attribute} for more information.
     * @public
     * @remarks
     * HTML Attribute: autofocus
     */
    autofocus: boolean;
    /**
     * When true, spin buttons will not be rendered
     * @public
     * @remarks
     * HTML Attribute: autofocus
     */
    hideStep: boolean;
    /**
     * Sets the placeholder value of the element, generally used to provide a hint to the user.
     * @public
     * @remarks
     * HTML Attribute: placeholder
     * Using this attribute does is not a valid substitute for a labeling element.
     */
    placeholder: string;
    /**
     * Allows associating a {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/datalist | datalist} to the element by {@link https://developer.mozilla.org/en-US/docs/Web/API/Element/id}.
     * @public
     * @remarks
     * HTML Attribute: list
     */
    list: string;
    /**
     * The maximum number of characters a user can enter.
     * @public
     * @remarks
     * HTMLAttribute: maxlength
     */
    maxlength: number;
    /**
     * The minimum number of characters a user can enter.
     * @public
     * @remarks
     * HTMLAttribute: minlength
     */
    minlength: number;
    /**
     * Sets the width of the element to a specified number of characters.
     * @public
     * @remarks
     * HTMLAttribute: size
     */
    size: number;
    /**
     * Amount to increment or decrement the value by
     * @public
     * @remarks
     * HTMLAttribute: step
     */
    step: number;
    /**
     * The maximum the value can be
     * @public
     * @remarks
     * HTMLAttribute: max
     */
    max: number;
    /**
     * Ensures that the max is greater than the min and that the value
     *  is less than the max
     * @param previous - the previous max value
     * @param next - updated max value
     *
     * @internal
     */
    maxChanged(previous: number, next: number): void;
    /**
     * The minimum the value can be
     * @public
     * @remarks
     * HTMLAttribute: min
     */
    min: number;
    /**
     * Ensures that the min is less than the max and that the value
     *  is greater than the min
     * @param previous - previous min value
     * @param next - updated min value
     *
     * @internal
     */
    minChanged(previous: number, next: number): void;
    /**
     * The default slotted items
     * @internal
     */
    defaultSlottedNodes: Node[];
    /**
     * A reference to the internal input element
     * @internal
     */
    control: HTMLInputElement;
    /**
     * Flag to indicate that the value change is from the user input
     * @internal
     */
    private isUserInput;
    /**
     * The value property, typed as a number.
     *
     * @public
     */
    get valueAsNumber(): number;
    set valueAsNumber(next: number);
    /**
     * Validates that the value is a number between the min and max
     * @param previous - previous stored value
     * @param next - value being updated
     * @param updateControl - should the text field be updated with value, defaults to true
     * @internal
     */
    valueChanged(previous: string, next: string): void;
    /**
     * Sets the internal value to a valid number between the min and max properties
     * @param value - user input
     *
     * @internal
     */
    private getValidValue;
    /**
     * Increments the value using the step value
     *
     * @public
     */
    stepUp(): void;
    /**
     * Decrements the value using the step value
     *
     * @public
     */
    stepDown(): void;
    /**
     * Sets up the initial state of the number field
     * @internal
     */
    connectedCallback(): void;
    /**
     * Handles the internal control's `input` event
     * @internal
     */
    handleTextInput(): void;
    /**
     * Change event handler for inner control.
     * @remarks
     * "Change" events are not `composable` so they will not
     * permeate the shadow DOM boundary. This fn effectively proxies
     * the change event, emitting a `change` event whenever the internal
     * control emits a `change` event
     * @internal
     */
    handleChange(): void;
    /**
     * Handles the internal control's `keydown` event
     * @internal
     */
    handleKeyDown(e: KeyboardEvent): boolean;
    /**
     * Handles populating the input field with a validated value when
     *  leaving the input field.
     * @internal
     */
    handleBlur(): void;
}
/**
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 * @internal
 */
export interface NumberField extends StartEnd, DelegatesARIATextbox {
}
