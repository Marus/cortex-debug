/** @internal */
export interface ContentRect {
    height: number;
    left: number;
    top: number;
    width: number;
}
/** @internal */
export declare const contentRect: (target: Element) => Readonly<ContentRect>;
/** @internal */
export declare class ResizeObserverEntry {
    readonly target: Element;
    readonly contentRect: ContentRect;
    constructor(target: Element);
}
/** @internal */
export declare class ResizeObserverClassDefinition {
    constructor(callback: ResizeObserverCallback);
    observe(target: Element): void;
    unobserve(target: Element): void;
    disconnect(): void;
}
/** @internal */
export declare type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserverClassDefinition) => void;
/** @internal */
export declare type ConstructibleResizeObserver = new (callback: ResizeObserverCallback) => ResizeObserverClassDefinition;
declare global {
    interface WindowWithResizeObserver extends Window {
        ResizeObserver: ConstructibleResizeObserver;
    }
}
