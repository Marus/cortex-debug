import { Constructable } from "@microsoft/fast-element";
/**
 * Indicates what to do with an ambiguous (duplicate) element.
 * @public
 */
export declare const ElementDisambiguation: Readonly<{
    /**
     * Skip defining the element but still call the provided callback passed
     * to DesignSystemRegistrationContext.tryDefineElement
     */
    definitionCallbackOnly: null;
    /**
     * Ignore the duplicate element entirely.
     */
    ignoreDuplicate: symbol;
}>;
/**
 * Represents the return values expected from an ElementDisambiguationCallback.
 * @public
 */
export declare type ElementDisambiguationResult = string | typeof ElementDisambiguation.ignoreDuplicate | typeof ElementDisambiguation.definitionCallbackOnly;
/**
 * The callback type that is invoked when two elements are trying to define themselves with
 * the same name.
 * @remarks
 * The callback should return either:
 * 1. A string to provide a new name used to disambiguate the element
 * 2. ElementDisambiguation.ignoreDuplicate to ignore the duplicate element entirely
 * 3. ElementDisambiguation.definitionCallbackOnly to skip defining the element but still
 * call the provided callback passed to DesignSystemRegistrationContext.tryDefineElement
 * @public
 */
export declare type ElementDisambiguationCallback = (nameAttempt: string, typeAttempt: Constructable, existingType: Constructable) => ElementDisambiguationResult;
/**
 * Represents a configurable design system.
 * @public
 */
export interface DesignSystem {
    /**
     * Registers components and services with the design system and the
     * underlying dependency injection container.
     * @param params - The registries to pass to the design system
     * and the underlying dependency injection container.
     * @public
     */
    register(...params: any[]): DesignSystem;
    /**
     * Configures the prefix to add to each custom element name.
     * @param prefix - The prefix to use for custom elements.
     * @public
     */
    withPrefix(prefix: string): DesignSystem;
    /**
     * Overrides the default Shadow DOM mode for custom elements.
     * @param mode - The Shadow DOM mode to use for custom elements.
     * @public
     */
    withShadowRootMode(mode: ShadowRootMode): DesignSystem;
    /**
     * Provides a custom callback capable of resolving scenarios where
     * two different elements request the same element name.
     * @param callback - The disambiguation callback.
     * @public
     */
    withElementDisambiguation(callback: ElementDisambiguationCallback): DesignSystem;
    /**
     * Overrides the {@link (DesignToken:interface)} root, controlling where
     * {@link (DesignToken:interface)} default value CSS custom properties
     * are emitted.
     *
     * Providing `null` disables automatic DesignToken registration.
     * @param root - the root to register
     * @public
     */
    withDesignTokenRoot(root: HTMLElement | Document | null): DesignSystem;
}
/**
 * An API gateway to design system features.
 * @public
 */
export declare const DesignSystem: Readonly<{
    /**
     * Returns the HTML element name that the type is defined as.
     * @param type - The type to lookup.
     * @public
     */
    tagFor(type: Constructable): string;
    /**
     * Searches the DOM hierarchy for the design system that is responsible
     * for the provided element.
     * @param element - The element to locate the design system for.
     * @returns The located design system.
     * @public
     */
    responsibleFor(element: HTMLElement): DesignSystem;
    /**
     * Gets the DesignSystem if one is explicitly defined on the provided element;
     * otherwise creates a design system defined directly on the element.
     * @param element - The element to get or create a design system for.
     * @returns The design system.
     * @public
     */
    getOrCreate(node?: Node | undefined): DesignSystem;
}>;
