import { SyntheticViewTemplate } from "@microsoft/fast-element";
import type { FoundationElementDefinition } from "../foundation-element";
import { FormAssociatedCheckbox } from "./checkbox.form-associated";
/**
 * Checkbox configuration options
 * @public
 */
export declare type CheckboxOptions = FoundationElementDefinition & {
    checkedIndicator?: string | SyntheticViewTemplate;
    indeterminateIndicator?: string | SyntheticViewTemplate;
};
/**
 * A Checkbox Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#checkbox | ARIA checkbox }.
 *
 * @public
 */
export declare class Checkbox extends FormAssociatedCheckbox {
    /**
     * When true, the control will be immutable by user interaction. See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/readonly | readonly HTML attribute} for more information.
     * @public
     * @remarks
     * HTML Attribute: readonly
     */
    readOnly: boolean;
    private readOnlyChanged;
    /**
     * The element's value to be included in form submission when checked.
     * Default to "on" to reach parity with input[type="checkbox"]
     *
     * @internal
     */
    initialValue: string;
    /**
     * @internal
     */
    defaultSlottedNodes: Node[];
    /**
     * The indeterminate state of the control
     */
    indeterminate: boolean;
    constructor();
    /**
     * @internal
     */
    keypressHandler: (e: KeyboardEvent) => void;
    /**
     * @internal
     */
    clickHandler: (e: MouseEvent) => void;
}
