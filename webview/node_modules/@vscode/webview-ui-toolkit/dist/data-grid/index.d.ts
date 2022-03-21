import { DataGridCellTypes, DataGridRowTypes, DataGrid as FoundationDataGrid, DataGridCell as FoundationDataGridCell, DataGridRow as FoundationDataGridRow, FoundationElementDefinition, GenerateHeaderOptions } from '@microsoft/fast-foundation';
export { DataGridCellTypes, DataGridRowTypes, GenerateHeaderOptions };
/**
 * The Visual Studio Code data grid class.
 *
 * @public
 */
export declare class DataGrid extends FoundationDataGrid {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code data grid component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid>`
 *
 * @public
 */
export declare const vsCodeDataGrid: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof DataGrid>;
/**
 * The Visual Studio Code data grid row class.
 *
 * @public
 */
export declare class DataGridRow extends FoundationDataGridRow {
}
/**
 * The Visual Studio Code data grid row component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid-row>`
 *
 * @public
 */
export declare const vsCodeDataGridRow: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof DataGridRow>;
/**
 * The Visual Studio Code data grid cell class.
 *
 * @public
 */
export declare class DataGridCell extends FoundationDataGridCell {
}
/**
 * The Visual Studio Code data grid cell component registration.
 *
 * @remarks
 * HTML Element: `<vscode-data-grid-cell>`
 *
 * @public
 */
export declare const vsCodeDataGridCell: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof DataGridCell>;
