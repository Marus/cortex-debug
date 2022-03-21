import { BaseProgress, ProgressRingOptions } from '@microsoft/fast-foundation';
/**
 * The Visual Studio Code progress ring class.
 *
 * @public
 */
export declare class ProgressRing extends BaseProgress {
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
 * The Visual Studio Code progress ring component registration.
 *
 * @remarks
 * HTML Element: `<vscode-progress-ring>`
 *
 * @public
 */
export declare const vsCodeProgressRing: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<ProgressRingOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<ProgressRingOptions, typeof ProgressRing>;
