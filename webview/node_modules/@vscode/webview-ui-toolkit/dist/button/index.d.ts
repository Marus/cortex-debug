import { ButtonOptions, Button as FoundationButton } from '@microsoft/fast-foundation';
/**
 * Types of button appearance.
 * @public
 */
export declare type ButtonAppearance = 'primary' | 'secondary' | 'icon';
/**
 * The Visual Studio Code button class.
 *
 * @public
 */
export declare class Button extends FoundationButton {
    /**
     * The appearance the button should have.
     *
     * @public
     */
    appearance: ButtonAppearance;
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
    /**
     * Component lifecycle method that runs when an attribute of the
     * element is changed.
     *
     * @param attrName - The attribute that was changed
     * @param oldVal - The old value of the attribute
     * @param newVal - The new value of the attribute
     *
     * @internal
     */
    attributeChangedCallback(attrName: string, oldVal: string, newVal: string): void;
}
/**
 * The Visual Studio Code button component registration.
 *
 * @remarks
 * HTML Element: `<vscode-button>`
 *
 * @public
 */
export declare const vsCodeButton: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<ButtonOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<ButtonOptions, typeof Button>;
