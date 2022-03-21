import { CheckboxOptions, Checkbox as FoundationCheckbox } from '@microsoft/fast-foundation';
/**
 * The Visual Studio Code checkbox class.
 *
 * @public
 */
export declare class Checkbox extends FoundationCheckbox {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code checkbox component registration.
 *
 * @remarks
 * HTML Element: `<vscode-checkbox>`
 *
 * @public
 */
export declare const vsCodeCheckbox: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<CheckboxOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<CheckboxOptions, typeof Checkbox>;
