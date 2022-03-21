import { SelectPosition as DropdownPosition, Select as FoundationSelect, SelectOptions } from '@microsoft/fast-foundation';
export { DropdownPosition };
/**
 * Dropdown configuration options
 * @public
 */
export declare type DropdownOptions = SelectOptions;
/**
 * The Visual Studio Code dropdown class.
 *
 * @public
 */
export declare class Dropdown extends FoundationSelect {
}
/**
 * The Visual Studio Code link dropdown registration.
 *
 * @remarks
 * HTML Element: `<vscode-dropdown>`
 *
 * @public
 */
export declare const vsCodeDropdown: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<SelectOptions> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<SelectOptions, typeof Dropdown>;
