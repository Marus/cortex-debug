import { ARIAGlobalStatesAndProperties, StartEnd, StartEndOptions } from "../patterns/index";
import type { FoundationElementDefinition } from "../foundation-element";
import { FormAssociatedButton } from "./button.form-associated";
/**
 * Button configuration options
 * @public
 */
export declare type ButtonOptions = FoundationElementDefinition & StartEndOptions;
/**
 * A Button Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element }.
 *
 * @public
 */
export declare class Button extends FormAssociatedButton {
    /**
     * Determines if the element should receive document focus on page load.
     *
     * @public
     * @remarks
     * HTML Attribute: autofocus
     */
    autofocus: boolean;
    /**
     * The id of a form to associate the element to.
     *
     * @public
     * @remarks
     * HTML Attribute: form
     */
    formId: string;
    /**
     * See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element} for more details.
     *
     * @public
     * @remarks
     * HTML Attribute: formaction
     */
    formaction: string;
    private formactionChanged;
    /**
     * See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element} for more details.
     *
     * @public
     * @remarks
     * HTML Attribute: formenctype
     */
    formenctype: string;
    private formenctypeChanged;
    /**
     * See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element} for more details.
     *
     * @public
     * @remarks
     * HTML Attribute: formmethod
     */
    formmethod: string;
    private formmethodChanged;
    /**
     * See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element} for more details.
     *
     * @public
     * @remarks
     * HTML Attribute: formnovalidate
     */
    formnovalidate: boolean;
    private formnovalidateChanged;
    /**
     * See {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element} for more details.
     *
     * @public
     * @remarks
     * HTML Attribute: formtarget
     */
    formtarget: "_self" | "_blank" | "_parent" | "_top";
    private formtargetChanged;
    /**
     * The button type.
     *
     * @public
     * @remarks
     * HTML Attribute: type
     */
    type: "submit" | "reset" | "button";
    private typeChanged;
    /**
     *
     * Default slotted content
     *
     * @public
     * @remarks
     */
    defaultSlottedContent: HTMLElement[];
    /**
     * @internal
     */
    connectedCallback(): void;
    /**
     * @internal
     */
    disconnectedCallback(): void;
    /**
     * Prevent events to propagate if disabled and has no slotted content wrapped in HTML elements
     * @internal
     */
    private handleClick;
    /**
     * Submits the parent form
     */
    private handleSubmission;
    /**
     * Resets the parent form
     */
    private handleFormReset;
    control: HTMLButtonElement;
    /**
     * Overrides the focus call for where delegatesFocus is unsupported.
     * This check works for Chrome, Edge Chromium, FireFox, and Safari
     * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
     */
    private handleUnsupportedDelegatesFocus;
}
/**
 * Includes ARIA states and properties relating to the ARIA button role
 *
 * @public
 */
export declare class DelegatesARIAButton {
    /**
     * See {@link https://www.w3.org/WAI/PF/aria/roles#button} for more information
     * @public
     * @remarks
     * HTML Attribute: aria-expanded
     */
    ariaExpanded: "true" | "false" | undefined;
    /**
     * See {@link https://www.w3.org/WAI/PF/aria/roles#button} for more information
     * @public
     * @remarks
     * HTML Attribute: aria-pressed
     */
    ariaPressed: "true" | "false" | "mixed" | undefined;
}
/**
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 * @internal
 */
export interface DelegatesARIAButton extends ARIAGlobalStatesAndProperties {
}
/**
 * Mark internal because exporting class and interface of the same name
 * confuses API documenter.
 * TODO: https://github.com/microsoft/fast/issues/3317
 * @internal
 */
export interface Button extends StartEnd, DelegatesARIAButton {
}
