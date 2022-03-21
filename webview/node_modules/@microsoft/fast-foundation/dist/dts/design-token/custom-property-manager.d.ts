export declare const defaultElement: HTMLDivElement;
interface PropertyTarget {
    setProperty(name: string, value: string | null): void;
    removeProperty(name: string): void;
}
/**
 * Controls emission for default values. This control is capable
 * of emitting to multiple {@link PropertyTarget | PropertyTargets},
 * and only emits if it has at least one root.
 *
 * @internal
 */
export declare class RootStyleSheetTarget implements PropertyTarget {
    private static roots;
    private static properties;
    setProperty(name: string, value: any): void;
    removeProperty(name: string): void;
    static registerRoot(root: HTMLElement | Document): void;
    static unregisterRoot(root: HTMLElement | Document): void;
    /**
     * Returns the document when provided the default element,
     * otherwise is a no-op
     * @param root - the root to normalize
     */
    private static normalizeRoot;
}
/**
 * Manages creation and caching of PropertyTarget instances.
 *
 * @internal
 */
export declare const PropertyTargetManager: Readonly<{
    getOrCreate(source: HTMLElement | Document): PropertyTarget;
}>;
export {};
