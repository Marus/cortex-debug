import { Radio as FoundationRadio, RadioOptions } from '@microsoft/fast-foundation';
/**
 * The Visual Studio Code radio class.
 *
 * @public
 */
export declare class Radio extends FoundationRadio {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code radio component registration.
 *
 * @remarks
 * HTML Element: `<vscode-radio>`
 *
 * @public
 */
export declare const vsCodeRadio: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<RadioOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<RadioOptions, typeof Radio>;
