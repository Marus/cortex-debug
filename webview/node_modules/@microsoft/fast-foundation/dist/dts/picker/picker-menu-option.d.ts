import { ViewTemplate } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * A picker list item Custom HTML Element.
 *
 * @alpha
 */
export declare class PickerMenuOption extends FoundationElement {
    /**
     * The underlying string value of the item
     *
     * @alpha
     * @remarks
     * HTML Attribute: value
     */
    value: string;
    /**
     *  The template used to render the contents of the list item
     *
     * @alpha
     */
    contentsTemplate: ViewTemplate;
    private contentsTemplateChanged;
    private customView;
    /**
     * @internal
     */
    connectedCallback(): void;
    /**
     * @internal
     */
    disconnectedCallback(): void;
    handleClick(e: MouseEvent): boolean;
    private handleInvoked;
    private updateView;
    private disconnectView;
}
