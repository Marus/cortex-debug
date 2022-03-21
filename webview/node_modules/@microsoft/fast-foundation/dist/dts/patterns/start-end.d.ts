import { SyntheticViewTemplate } from "@microsoft/fast-element";
import type { ViewTemplate } from "@microsoft/fast-element";
import type { ElementDefinitionContext } from "../design-system";
/**
 * Start configuration options
 * @public
 */
export declare type StartOptions = {
    start?: string | SyntheticViewTemplate;
};
/**
 * End configuration options
 * @public
 */
export declare type EndOptions = {
    end?: string | SyntheticViewTemplate;
};
/**
 * Start/End configuration options
 * @public
 */
export declare type StartEndOptions = StartOptions & EndOptions;
/**
 * A mixin class implementing start and end elements.
 * These are generally used to decorate text elements with icons or other visual indicators.
 * @public
 */
export declare class StartEnd {
    start: HTMLSlotElement;
    startContainer: HTMLSpanElement;
    handleStartContentChange(): void;
    end: HTMLSlotElement;
    endContainer: HTMLSpanElement;
    handleEndContentChange(): void;
}
/**
 * The template for the end element.
 * For use with {@link StartEnd}
 *
 * @public
 */
export declare const endSlotTemplate: (context: ElementDefinitionContext, definition: EndOptions) => ViewTemplate<StartEnd>;
/**
 * The template for the start element.
 * For use with {@link StartEnd}
 *
 * @public
 */
export declare const startSlotTemplate: (context: ElementDefinitionContext, definition: StartOptions) => ViewTemplate<StartEnd>;
/**
 * The template for the end element.
 * For use with {@link StartEnd}
 *
 * @public
 * @deprecated - use endSlotTemplate
 */
export declare const endTemplate: ViewTemplate<StartEnd>;
/**
 * The template for the start element.
 * For use with {@link StartEnd}
 *
 * @public
 * @deprecated - use startSlotTemplate
 */
export declare const startTemplate: ViewTemplate<StartEnd>;
