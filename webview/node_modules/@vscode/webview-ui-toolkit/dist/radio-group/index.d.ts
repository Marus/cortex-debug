import { Orientation as RadioGroupOrientation } from '@microsoft/fast-web-utilities';
import { FoundationElementDefinition, RadioGroup as FoundationRadioGroup } from '@microsoft/fast-foundation';
export { RadioGroupOrientation };
/**
 * The Visual Studio Code radio group class.
 *
 * @public
 */
export declare class RadioGroup extends FoundationRadioGroup {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code radio group component registration.
 *
 * @remarks
 * HTML Element: `<vscode-radio-group>`
 *
 * @public
 */
export declare const vsCodeRadioGroup: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof RadioGroup>;
