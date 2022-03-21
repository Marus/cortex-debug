import { Badge as FoundationBadge, FoundationElementDefinition } from '@microsoft/fast-foundation';
/**
 * The Visual Studio Code badge class.
 *
 * @public
 */
export declare class Badge extends FoundationBadge {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code badge component registration.
 *
 * @remarks
 * HTML Element: `<vscode-badge>`
 *
 * @public
 */
export declare const vsCodeBadge: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof Badge>;
