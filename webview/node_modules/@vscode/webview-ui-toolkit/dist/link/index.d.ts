import { AnchorOptions, Anchor as FoundationAnchor } from '@microsoft/fast-foundation';
/**
 * Link configuration options
 * @public
 */
export declare type LinkOptions = AnchorOptions;
/**
 * The Visual Studio Code link class.
 *
 * @public
 */
export declare class Link extends FoundationAnchor {
}
/**
 * The Visual Studio Code link component registration.
 *
 * @remarks
 * HTML Element: `<vscode-link>`
 *
 * @public
 */
export declare const vsCodeLink: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<AnchorOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<AnchorOptions, typeof Link>;
