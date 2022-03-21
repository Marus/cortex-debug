import { FoundationElementDefinition, Tab as FoundationTab, TabPanel as FoundationTabPanel, Tabs as FoundationTabs } from '@microsoft/fast-foundation';
/**
 * The Visual Studio Code panels class.
 *
 * @public
 */
export declare class Panels extends FoundationTabs {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code panels component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panels>`
 *
 * @public
 */
export declare const vsCodePanels: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof Panels>;
/**
 * The Visual Studio Code panel tab class.
 *
 * @public
 */
export declare class PanelTab extends FoundationTab {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code panel tab component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panel-tab>`
 *
 * @public
 */
export declare const vsCodePanelTab: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof PanelTab>;
/**
 * The Visual Studio Code panel view class.
 *
 * @public
 */
export declare class PanelView extends FoundationTabPanel {
}
/**
 * The Visual Studio Code panel view component registration.
 *
 * @remarks
 * HTML Element: `<vscode-panel-view>`
 *
 * @public
 */
export declare const vsCodePanelView: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof PanelView>;
