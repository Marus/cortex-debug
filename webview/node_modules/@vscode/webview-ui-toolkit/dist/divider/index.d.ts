import { DividerRole, Divider as FoundationDivider, FoundationElementDefinition } from '@microsoft/fast-foundation';
export { DividerRole };
/**
 * The Visual Studio Code divider class.
 *
 * @public
 */
export declare class Divider extends FoundationDivider {
}
/**
 * The Visual Studio Code divider component registration.
 *
 * @remarks
 * HTML Element: `<vscode-divider>`
 *
 * @public
 */
export declare const vsCodeDivider: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof Divider>;
