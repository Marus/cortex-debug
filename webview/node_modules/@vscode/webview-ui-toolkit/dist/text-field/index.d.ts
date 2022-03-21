import { TextField as FoundationTextField, TextFieldOptions, TextFieldType } from '@microsoft/fast-foundation';
export { TextFieldType };
/**
 * The Visual Studio Code text field class.
 *
 * @public
 */
export declare class TextField extends FoundationTextField {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code text field component registration.
 *
 * @remarks
 * HTML Element: `<vscode-text-field>`
 *
 * @public
 */
export declare const vsCodeTextField: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<TextFieldOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<TextFieldOptions, typeof TextField>;
