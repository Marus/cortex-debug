import { FoundationElementDefinition, TextArea as FoundationTextArea, TextAreaResize } from '@microsoft/fast-foundation';
export { TextAreaResize };
/**
 * The Visual Studio Code text area class.
 *
 * @remarks
 * HTML Element: `<vscode-text-area>`
 *
 * @public
 */
export declare class TextArea extends FoundationTextArea {
    /**
     * Component lifecycle method that runs when the component is inserted
     * into the DOM.
     *
     * @internal
     */
    connectedCallback(): void;
}
/**
 * The Visual Studio Code text area component registration.
 *
 * @remarks
 * HTML Element: `<vscode-text-area>`
 *
 * @public
 */
export declare const vsCodeTextArea: (overrideDefinition?: import("@microsoft/fast-foundation").OverrideFoundationElementDefinition<FoundationElementDefinition> | undefined) => import("@microsoft/fast-foundation").FoundationElementRegistry<FoundationElementDefinition, typeof TextArea>;
