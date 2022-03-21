import { FoundationElement } from "../foundation-element";
/**
 * A Switch Custom HTML Element.
 * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#dialog | ARIA dialog }.
 *
 * @public
 */
export declare class Dialog extends FoundationElement {
    /**
     * Indicates the element is modal. When modal, user mouse interaction will be limited to the contents of the element by a modal
     * overlay.  Clicks on the overlay will cause the dialog to emit a "dismiss" event.
     * @public
     * @defaultValue - true
     * @remarks
     * HTML Attribute: modal
     */
    modal: boolean;
    /**
     * The hidden state of the element.
     *
     * @public
     * @defaultValue - false
     * @remarks
     * HTML Attribute: hidden
     */
    hidden: boolean;
    /**
     * Indicates that the dialog should trap focus.
     *
     * @public
     * @defaultValue - true
     * @remarks
     * HTML Attribute: trap-focus
     */
    trapFocus: boolean;
    private trapFocusChanged;
    /**
     * The id of the element describing the dialog.
     * @public
     * @remarks
     * HTML Attribute: aria-describedby
     */
    ariaDescribedby: string;
    /**
     * The id of the element labeling the dialog.
     * @public
     * @remarks
     * HTML Attribute: aria-labelledby
     */
    ariaLabelledby: string;
    /**
     * The label surfaced to assistive technologies.
     *
     * @public
     * @remarks
     * HTML Attribute: aria-label
     */
    ariaLabel: string;
    /**
     * @internal
     */
    dialog: HTMLDivElement;
    /**
     * @internal
     */
    private isTrappingFocus;
    /**
     * @internal
     */
    private notifier;
    /**
     * @internal
     */
    dismiss(): void;
    /**
     * The method to show the dialog.
     *
     * @public
     */
    show(): void;
    /**
     * The method to hide the dialog.
     *
     * @public
     */
    hide(): void;
    /**
     * @internal
     */
    connectedCallback(): void;
    /**
     * @internal
     */
    disconnectedCallback(): void;
    /**
     * @internal
     */
    handleChange(source: any, propertyName: string): void;
    private handleDocumentKeydown;
    private handleDocumentFocus;
    private handleTabKeyDown;
    private getTabQueueBounds;
    /**
     * focus on first element of tab queue
     */
    private focusFirstElement;
    /**
     * we should only focus if focus has not already been brought to the dialog
     */
    private shouldForceFocus;
    /**
     * we should we be active trapping focus
     */
    private shouldTrapFocus;
    /**
     *
     *
     * @internal
     */
    private updateTrapFocus;
    /**
     * Reduce a collection to only its focusable elements.
     *
     * @param elements - Collection of elements to reduce
     * @param element - The current element
     *
     * @internal
     */
    private static reduceTabbableItems;
    /**
     * Test if element is focusable fast element
     *
     * @param element - The element to check
     *
     * @internal
     */
    private static isFocusableFastElement;
    /**
     * Test if the element has a focusable shadow
     *
     * @param element - The element to check
     *
     * @internal
     */
    private static hasTabbableShadow;
}
