import { FoundationElement } from "../foundation-element";
/**
 * A List Picker Menu Custom HTML Element.
 *
 * @alpha
 */
export declare class PickerMenu extends FoundationElement {
    /**
     *  Elements in the default slot
     *
     * @internal
     */
    menuElements: HTMLElement[];
    menuElementsChanged(): void;
    /**
     *  Elements in the header slot
     *
     *
     * @internal
     */
    headerElements: HTMLElement[];
    headerElementsChanged(): void;
    /**
     *  Elements in the footer slot
     *
     *
     * @internal
     */
    footerElements: HTMLElement[];
    footerElementsChanged(): void;
    /**
     * Text to display to assistive technology when
     * suggestions are available
     *
     * @alpha
     */
    suggestionsAvailableText: string;
    /**
     * Children that are list items
     *
     * @internal
     */
    optionElements: HTMLElement[];
    private updateOptions;
    private addSlottedListItems;
}
