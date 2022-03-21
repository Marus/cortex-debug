import { ListboxOption as FoundationListboxOption, ListboxOptionOptions } from '@microsoft/fast-foundation';
/**
 * Dropdown option configuration options
 * @public
 */
export declare type OptionOptions = ListboxOptionOptions;
/**
 * The Visual Studio Code option class.
 *
 * @public
 */
export declare class Option extends FoundationListboxOption {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code option component registration.
 *
 * @remarks
 * HTML Element: `<vscode-option>`
 *
 * @public
 */
export declare const vsCodeOption: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<ListboxOptionOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<ListboxOptionOptions, typeof Option>;
