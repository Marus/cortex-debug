import { FoundationElement } from "../foundation-element";
/**
 * Defines the base behavior of an anchored region on a particular axis
 *
 * @public
 */
export declare type AxisPositioningMode = "uncontrolled" | "locktodefault" | "dynamic";
/**
 * Defines the scaling behavior of an anchored region on a particular axis
 *
 * @public
 */
export declare type AxisScalingMode = "anchor" | "fill" | "content";
/**
 * Defines the horizontal positioning options for an anchored region
 *
 * @public
 */
export declare type HorizontalPosition = "start" | "end" | "left" | "right" | "center" | "unset";
/**
 * Defines the vertical positioning options for an anchored region
 *
 * @public
 */
export declare type VerticalPosition = "top" | "bottom" | "center" | "unset";
/**
 * Defines if the component updates its position automatically. Calling update() always provokes an update.
 * anchor - the component only updates its position when the anchor resizes (default)
 * auto - the component updates its position when:
 * - update() is called
 * - the anchor resizes
 * - the window resizes
 * - the viewport resizes
 * - any scroll event in the document
 *
 * @public
 */
export declare type AutoUpdateMode = "anchor" | "auto";
/**
 * Describes the possible positions of the region relative
 * to its anchor. Depending on the axis start = left/top, end = right/bottom
 *
 * @public
 */
export declare type AnchoredRegionPositionLabel = "start" | "insetStart" | "insetEnd" | "end" | "center";
/**
 * An anchored region Custom HTML Element.
 *
 * @public
 */
export declare class AnchoredRegion extends FoundationElement {
    /**
     * The HTML ID of the anchor element this region is positioned relative to
     *
     * @public
     * @remarks
     * HTML Attribute: anchor
     */
    anchor: string;
    private anchorChanged;
    /**
     * The HTML ID of the viewport element this region is positioned relative to
     *
     * @public
     * @remarks
     * HTML Attribute: anchor
     */
    viewport: string;
    private viewportChanged;
    /**
     * Sets what logic the component uses to determine horizontal placement.
     * 'locktodefault' forces the default position
     * 'dynamic' decides placement based on available space
     * 'uncontrolled' does not control placement on the horizontal axis
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-positioning-mode
     */
    horizontalPositioningMode: AxisPositioningMode;
    private horizontalPositioningModeChanged;
    /**
     * The default horizontal position of the region relative to the anchor element
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-default-position
     */
    horizontalDefaultPosition: HorizontalPosition;
    private horizontalDefaultPositionChanged;
    /**
     * Whether the region remains in the viewport (ie. detaches from the anchor) on the horizontal axis
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-viewport-lock
     */
    horizontalViewportLock: boolean;
    private horizontalViewportLockChanged;
    /**
     * Whether the region overlaps the anchor on the horizontal axis
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-inset
     */
    horizontalInset: boolean;
    private horizontalInsetChanged;
    /**
     * How narrow the space allocated to the default position has to be before the widest area
     * is selected for layout
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-threshold
     */
    horizontalThreshold: number;
    private horizontalThresholdChanged;
    /**
     * Defines how the width of the region is calculated
     *
     * @public
     * @remarks
     * HTML Attribute: horizontal-scaling
     */
    horizontalScaling: AxisScalingMode;
    private horizontalScalingChanged;
    /**
     * Sets what logic the component uses to determine vertical placement.
     * 'locktodefault' forces the default position
     * 'dynamic' decides placement based on available space
     * 'uncontrolled' does not control placement on the vertical axis
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-positioning-mode
     */
    verticalPositioningMode: AxisPositioningMode;
    private verticalPositioningModeChanged;
    /**
     * The default vertical position of the region relative to the anchor element
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-default-position
     */
    verticalDefaultPosition: VerticalPosition;
    private verticalDefaultPositionChanged;
    /**
     * Whether the region remains in the viewport (ie. detaches from the anchor) on the vertical axis
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-viewport-lock
     */
    verticalViewportLock: boolean;
    private verticalViewportLockChanged;
    /**
     * Whether the region overlaps the anchor on the vertical axis
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-inset
     */
    verticalInset: boolean;
    private verticalInsetChanged;
    /**
     * How short the space allocated to the default position has to be before the tallest area
     * is selected for layout
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-threshold
     */
    verticalThreshold: number;
    private verticalThresholdChanged;
    /**
     * Defines how the height of the region is calculated
     *
     * @public
     * @remarks
     * HTML Attribute: vertical-scaling
     */
    verticalScaling: AxisScalingMode;
    private verticalScalingChanged;
    /**
     * Whether the region is positioned using css "position: fixed".
     * Otherwise the region uses "position: absolute".
     * Fixed placement allows the region to break out of parent containers,
     *
     * @public
     * @remarks
     * HTML Attribute: fixed-placement
     */
    fixedPlacement: boolean;
    private fixedPlacementChanged;
    /**
     * Defines what triggers the anchored region to revaluate positioning
     *
     * @public
     * @remarks
     * HTML Attribute: auto-update-mode
     */
    autoUpdateMode: AutoUpdateMode;
    private autoUpdateModeChanged;
    /**
     * The HTML element being used as the anchor
     *
     * @public
     */
    anchorElement: HTMLElement | null;
    private anchorElementChanged;
    /**
     * The HTML element being used as the viewport
     *
     * @public
     */
    viewportElement: HTMLElement | null;
    private viewportElementChanged;
    /**
     * indicates that an initial positioning pass on layout has completed
     *
     * @internal
     */
    initialLayoutComplete: boolean;
    /**
     * indicates the current horizontal position of the region
     */
    verticalPosition: AnchoredRegionPositionLabel | undefined;
    /**
     * indicates the current vertical position of the region
     */
    horizontalPosition: AnchoredRegionPositionLabel | undefined;
    /**
     * values to be applied to the component's transform on render
     */
    private translateX;
    private translateY;
    /**
     * the span to be applied to the region on each axis
     */
    private regionWidth;
    private regionHeight;
    private resizeDetector;
    private viewportRect;
    private anchorRect;
    private regionRect;
    /**
     * base offsets between the positioner's base position and the anchor's
     */
    private baseHorizontalOffset;
    private baseVerticalOffset;
    private pendingPositioningUpdate;
    private pendingReset;
    private currentDirection;
    private regionVisible;
    private forceUpdate;
    private updateThreshold;
    private static intersectionService;
    /**
     * @internal
     */
    connectedCallback(): void;
    /**
     * @internal
     */
    disconnectedCallback(): void;
    /**
     * @internal
     */
    adoptedCallback(): void;
    /**
     * update position
     */
    update: () => void;
    /**
     * destroys the instance's resize observer
     */
    private disconnectResizeDetector;
    /**
     * initializes the instance's resize observer
     */
    private initializeResizeDetector;
    /**
     * react to attribute changes that don't require a reset
     */
    private updateForAttributeChange;
    /**
     * fully initializes the component
     */
    private initialize;
    /**
     * Request a reset if there are currently no open requests
     */
    private requestReset;
    /**
     * sets the starting configuration for component internal values
     */
    private setInitialState;
    /**
     * starts observers
     */
    private startObservers;
    /**
     * get position updates
     */
    private requestPositionUpdates;
    /**
     * stops observers
     */
    private stopObservers;
    /**
     * Gets the viewport element by id, or defaults to document root
     */
    private getViewport;
    /**
     *  Gets the anchor element by id
     */
    private getAnchor;
    /**
     *  Handle intersections
     */
    private handleIntersection;
    /**
     *  iterate through intersection entries and apply data
     */
    private applyIntersectionEntries;
    /**
     *  Update the offset values
     */
    private updateRegionOffset;
    /**
     *  compare rects to see if there is enough change to justify a DOM update
     */
    private isRectDifferent;
    /**
     *  Handle resize events
     */
    private handleResize;
    /**
     * resets the component
     */
    private reset;
    /**
     *  Recalculate layout related state values
     */
    private updateLayout;
    /**
     *  Updates the style string applied to the region element as well as the css classes attached
     *  to the root element
     */
    private updateRegionStyle;
    /**
     *  Updates the css classes that reflect the current position of the element
     */
    private updatePositionClasses;
    /**
     * Get horizontal positioning state based on desired position
     */
    private setHorizontalPosition;
    /**
     * Set vertical positioning state based on desired position
     */
    private setVerticalPosition;
    /**
     *  Get available positions based on positioning mode
     */
    private getPositioningOptions;
    /**
     *  Get the space available for a particular relative position
     */
    private getAvailableSpace;
    /**
     * Get region dimensions
     */
    private getNextRegionDimension;
    /**
     * starts event listeners that can trigger auto updating
     */
    private startAutoUpdateEventListeners;
    /**
     * stops event listeners that can trigger auto updating
     */
    private stopAutoUpdateEventListeners;
}
