import type { SyntheticViewTemplate } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
import type { FoundationElementDefinition, FoundationElementTemplate } from "../foundation-element";
import type { StartEndOptions } from "../patterns/start-end";
/**
 * The views types for a horizontal-scroll {@link @microsoft/fast-foundation#(HorizontalScroll:class)}
 * @public
 */
export declare type HorizontalScrollView = "default" | "mobile";
/**
 * The easing types available for the horizontal-scroll {@link @microsoft/fast-foundation#(HorizontalScroll:class)}
 * @public
 */
export declare type ScrollEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | string;
/**
 * Horizontal scroll configuration options
 * @public
 */
export declare type HorizontalScrollOptions = FoundationElementDefinition & StartEndOptions & {
    nextFlipper?: FoundationElementTemplate<SyntheticViewTemplate<any, HorizontalScroll>, HorizontalScrollOptions> | SyntheticViewTemplate | string;
    previousFlipper?: FoundationElementTemplate<SyntheticViewTemplate<any, HorizontalScroll>, HorizontalScrollOptions> | SyntheticViewTemplate | string;
};
/**
 * A HorizontalScroll Custom HTML Element
 * @public
 */
export declare class HorizontalScroll extends FoundationElement {
    /**
     * Reference to DOM element that scrolls the content
     * @public
     */
    scrollContainer: HTMLDivElement;
    /**
     * Reference to DOM element that holds the slotted content
     * @public
     */
    content: HTMLDivElement;
    /**
     * Reference to flipper to scroll to previous content
     * @public
     */
    previousFlipperContainer: HTMLDivElement;
    /**
     * Reference to flipper to scroll to the next content
     * @public
     */
    nextFlipperContainer: HTMLDivElement;
    /**
     * @internal
     */
    private framesPerSecond;
    /**
     * The calculated duration for a frame.
     *
     * @internal
     */
    private get frameTime();
    /**
     * The timeout identifier for the scroll event throttling.
     *
     * @internal
     */
    private resizeTimeout?;
    /**
     * The timeout identifier for the scroll event throttling.
     *
     * @internal
     */
    private scrollTimeout?;
    /**
     * Flag indicating that the items are being updated
     *
     * @internal
     */
    private updatingItems;
    /**
     * Speed of scroll in pixels per second
     * @public
     */
    speed: number;
    /**
     * The CSS time value for the scroll transition duration. Overrides the `speed` attribute.
     *
     * @remarks
     * When `duration` is set, the `speed` attribute has no effect.
     *
     * @public
     */
    duration: string;
    /**
     * Attribute used for easing, defaults to ease-in-out
     * @public
     */
    easing: ScrollEasing;
    /**
     * Attribute to hide flippers from assistive technology
     * @public
     */
    flippersHiddenFromAT: boolean;
    /**
     * Scrolling state
     * @internal
     */
    private scrolling;
    /**
     * Firing scrollstart and scrollend events
     * @internal
     */
    scrollingChanged(prev: unknown, next: boolean): void;
    /**
     * Detects if the component has been resized
     * @internal
     */
    private resizeDetector;
    /**
     * Width of the parent container
     * @internal
     */
    private width;
    /**
     * Scroll stop positions between elements
     * @internal
     */
    private scrollStops;
    /**
     * The default slotted items placed in the scrolling container.
     *
     * @public
     */
    scrollItems: HTMLElement[];
    /**
     * In RTL mode
     * @internal
     */
    private get isRtl();
    /**
     * View: default | mobile
     * @public
     */
    view: HorizontalScrollView;
    connectedCallback(): void;
    disconnectedCallback(): void;
    /**
     * Updates scroll stops and flippers when scroll items change
     * @param previous - current scroll items
     * @param next - new updated scroll items
     * @public
     */
    scrollItemsChanged(previous: HTMLElement[], next: HTMLElement[]): void;
    /**
     * destroys the instance's resize observer
     * @internal
     */
    private disconnectResizeDetector;
    /**
     * initializes the instance's resize observer
     * @internal
     */
    private initializeResizeDetector;
    /**
     * Looks for slots and uses child nodes instead
     * @internal
     */
    private updateScrollStops;
    /**
     * Finds all of the scroll stops between elements
     * @internal
     */
    private setStops;
    /**
     *
     */
    private fixScrollMisalign;
    /**
     * Sets the controls view if enabled
     * @internal
     */
    private setFlippers;
    /**
     * Lets the user arrow left and right through the horizontal scroll
     * @param e - Keyboard event
     * @public
     */
    keyupHandler(e: Event & KeyboardEvent): void;
    /**
     * Scrolls items to the left
     * @public
     */
    scrollToPrevious(): void;
    /**
     * Scrolls items to the right
     * @public
     */
    scrollToNext(): void;
    /**
     * Handles scrolling with easing
     * @param position - starting position
     * @param newPosition - position to scroll to
     * @public
     */
    scrollToPosition(newPosition: number, position?: number): void;
    /**
     * Monitors resize event on the horizontal-scroll element
     * @public
     */
    resized(): void;
    /**
     * Monitors scrolled event on the content container
     * @public
     */
    scrolled(): void;
}
