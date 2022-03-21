import { ViewTemplate } from "@microsoft/fast-element";
import { AnchoredRegion, AnchoredRegionConfig } from "../anchored-region";
import type { PickerMenu } from "./picker-menu";
import { FormAssociatedPicker } from "./picker.form-associated";
import type { PickerList } from "./picker-list";
/**
 * Defines the vertical positioning options for an anchored region
 *
 * @beta
 */
export declare type menuConfigs = "bottom" | "bottom-fill" | "tallest" | "tallest-fill" | "top" | "top-fill";
/**
 * A Picker Custom HTML Element.  This is an early "alpha" version of the component.
 * Developers should expect the api to evolve, breaking changes are possible.
 *
 * @alpha
 */
export declare class Picker extends FormAssociatedPicker {
    /**
     * Currently selected items. Comma delineated string ie. "apples,oranges".
     *
     * @alpha
     * @remarks
     * HTML Attribute: selection
     */
    selection: string;
    private selectionChanged;
    /**
     * Currently available options. Comma delineated string ie. "apples,oranges".
     *
     * @alpha
     * @remarks
     * HTML Attribute: options
     */
    options: string;
    private optionsChanged;
    /**
     * Whether the component should remove an option from the list when it is in the selection
     *
     * @alpha
     * @remarks
     * HTML Attribute: filter-selected
     */
    filterSelected: boolean;
    /**
     * Whether the component should remove options based on the current query
     *
     * @alpha
     * @remarks
     * HTML Attribute: filter-query
     */
    filterQuery: boolean;
    /**
     * The maximum number of items that can be selected.
     *
     * @alpha
     * @remarks
     * HTML Attribute: max-selected
     */
    maxSelected: number | undefined;
    /**
     * The text to present to assistive technolgies when no suggestions are available.
     *
     * @alpha
     * @remarks
     * HTML Attribute: no-suggestions-text
     */
    noSuggestionsText: string;
    /**
     *  The text to present to assistive technolgies when suggestions are available.
     *
     * @alpha
     * @remarks
     * HTML Attribute: suggestions-available-text
     */
    suggestionsAvailableText: string;
    /**
     * The text to present to assistive technologies when suggestions are loading.
     *
     * @alpha
     * @remarks
     * HTML Attribute: loading-text
     */
    loadingText: string;
    /**
     * Applied to the aria-label attribute of the input element
     *
     * @alpha
     * @remarks
     * HTML Attribute: label
     */
    label: string;
    /**
     * Applied to the aria-labelledby attribute of the input element
     *
     * @alpha
     * @remarks
     * HTML Attribute: labelledby
     */
    labelledBy: string;
    /**
     * Applied to the placeholder attribute of the input element
     *
     * @alpha
     * @remarks
     * HTML Attribute: placholder
     */
    placeholder: string;
    /**
     * Controls menu placement
     *
     * @alpha
     * @remarks
     * HTML Attribute: menu-placement
     */
    menuPlacement: menuConfigs;
    private menuPlacementChanged;
    /**
     * Whether to display a loading state if the menu is opened.
     *
     * @alpha
     */
    showLoading: boolean;
    private showLoadingChanged;
    /**
     * Template used to generate selected items.
     * This is used in a repeat directive.
     *
     * @alpha
     */
    listItemTemplate: ViewTemplate;
    private listItemTemplateChanged;
    /**
     * Default template to use for selected items (usually specified in the component template).
     * This is used in a repeat directive.
     *
     * @alpha
     */
    defaultListItemTemplate?: ViewTemplate;
    private defaultListItemTemplateChanged;
    /**
     * The item template currently in use.
     *
     * @internal
     */
    activeListItemTemplate?: ViewTemplate;
    /**
     * Template to use for available options.
     * This is used in a repeat directive.
     *
     * @alpha
     */
    menuOptionTemplate: ViewTemplate;
    private menuOptionTemplateChanged;
    /**
     * Default template to use for available options (usually specified in the template).
     * This is used in a repeat directive.
     *
     * @alpha
     */
    defaultMenuOptionTemplate?: ViewTemplate;
    private defaultMenuOptionTemplateChanged;
    /**
     * The option template currently in use.
     *
     * @internal
     */
    activeMenuOptionTemplate?: ViewTemplate;
    /**
     *  Template to use for the contents of a selected list item
     *
     * @alpha
     */
    listItemContentsTemplate: ViewTemplate;
    /**
     *  Template to use for the contents of menu options
     *
     * @alpha
     */
    menuOptionContentsTemplate: ViewTemplate;
    /**
     *  Current list of options in array form
     *
     * @alpha
     */
    optionsList: string[];
    private optionsListChanged;
    /**
     * The text value currently in the input field
     *
     * @alpha
     */
    query: string;
    private queryChanged;
    /**
     *  Current list of filtered options in array form
     *
     * @internal
     */
    filteredOptionsList: string[];
    private filteredOptionsListChanged;
    /**
     *  Indicates if the flyout menu is open or not
     *
     * @internal
     */
    flyoutOpen: boolean;
    private flyoutOpenChanged;
    /**
     *  The id of the menu element
     *
     * @internal
     */
    menuId: string;
    /**
     *  The tag for the selected list element (ie. "fast-picker-list" vs. "fluent-picker-list")
     *
     * @internal
     */
    selectedListTag: string;
    /**
     * The tag for the menu element (ie. "fast-picker-menu" vs. "fluent-picker-menu")
     *
     * @internal
     */
    menuTag: string;
    /**
     *  Index of currently active menu option
     *
     * @internal
     */
    menuFocusIndex: number;
    /**
     *  Id of currently active menu option.
     *
     * @internal
     */
    menuFocusOptionId: string | undefined;
    /**
     *  Internal flag to indicate no options available display should be shown.
     *
     * @internal
     */
    showNoOptions: boolean;
    private showNoOptionsChanged;
    /**
     *  The anchored region config to apply.
     *
     * @internal
     */
    menuConfig: AnchoredRegionConfig;
    /**
     *  Reference to the placeholder element for the repeat directive
     *
     * @alpha
     */
    itemsPlaceholderElement: Node;
    /**
     * reference to the input element
     *
     * @internal
     */
    inputElement: HTMLInputElement;
    /**
     * reference to the selected list element
     *
     * @internal
     */
    listElement: PickerList;
    /**
     * reference to the menu element
     *
     * @internal
     */
    menuElement: PickerMenu;
    /**
     * reference to the anchored region element
     *
     * @internal
     */
    region: AnchoredRegion;
    /**
     *
     *
     * @internal
     */
    selectedItems: string[];
    private itemsRepeatBehavior;
    private optionsRepeatBehavior;
    private optionsPlaceholder;
    private inputElementView;
    /**
     * @internal
     */
    connectedCallback(): void;
    disconnectedCallback(): void;
    /**
     * Move focus to the input element
     * @public
     */
    focus(): void;
    /**
     * Initialize the component.  This is delayed a frame to ensure children are connected as well.
     */
    private initialize;
    /**
     * Toggles the menu flyout
     */
    private toggleFlyout;
    /**
     * Handle input event from input element
     */
    private handleTextInput;
    /**
     * Handle click event from input element
     */
    private handleInputClick;
    /**
     * Handle the menu options updated event from the child menu
     */
    private handleMenuOptionsUpdated;
    /**
     * Handle key down events.
     */
    handleKeyDown(e: KeyboardEvent): boolean;
    /**
     * Handle focus in events.
     */
    handleFocusIn(e: FocusEvent): boolean;
    /**
     * Handle focus out events.
     */
    handleFocusOut(e: FocusEvent): boolean;
    /**
     * The list of selected items has changed
     */
    handleSelectionChange(): void;
    /**
     * Anchored region is loaded, menu and options exist in the DOM.
     */
    handleRegionLoaded(e: Event): void;
    /**
     * Sets properties on the anchored region once it is instanciated.
     */
    private setRegionProps;
    /**
     * Checks if the maximum number of items has been chosen and updates the ui.
     */
    private checkMaxItems;
    /**
     * A list item has been invoked.
     */
    handleItemInvoke(e: Event): boolean;
    /**
     * A menu option has been invoked.
     */
    handleOptionInvoke(e: Event): boolean;
    /**
     * Increments the focused list item by the specified amount
     */
    private incrementFocusedItem;
    /**
     * Disables the menu. Note that the menu can be open, just doens't have any valid options on display.
     */
    private disableMenu;
    /**
     * Sets the currently focused menu option by index
     */
    private setFocusedOption;
    /**
     * Updates the template used for the list item repeat behavior
     */
    private updateListItemTemplate;
    /**
     * Updates the template used for the menu option repeat behavior
     */
    private updateOptionTemplate;
    /**
     * Updates the filtered options array
     */
    private updateFilteredOptions;
    /**
     * Updates the menu configuration
     */
    private updateMenuConfig;
    /**
     * matches menu placement values with the associated menu config
     */
    private configLookup;
}
