import { __decorate } from "tslib";
import { attr, DOM, observable } from "@microsoft/fast-element";
import { Direction, eventResize, eventScroll } from "@microsoft/fast-web-utilities";
import { FoundationElement } from "../foundation-element";
import { getDirection } from "../utilities/direction";
import { IntersectionService } from "../utilities/intersection-service";
/**
 * An anchored region Custom HTML Element.
 *
 * @public
 */
export class AnchoredRegion extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * The HTML ID of the anchor element this region is positioned relative to
         *
         * @public
         * @remarks
         * HTML Attribute: anchor
         */
        this.anchor = "";
        /**
         * The HTML ID of the viewport element this region is positioned relative to
         *
         * @public
         * @remarks
         * HTML Attribute: anchor
         */
        this.viewport = "";
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
        this.horizontalPositioningMode = "uncontrolled";
        /**
         * The default horizontal position of the region relative to the anchor element
         *
         * @public
         * @remarks
         * HTML Attribute: horizontal-default-position
         */
        this.horizontalDefaultPosition = "unset";
        /**
         * Whether the region remains in the viewport (ie. detaches from the anchor) on the horizontal axis
         *
         * @public
         * @remarks
         * HTML Attribute: horizontal-viewport-lock
         */
        this.horizontalViewportLock = false;
        /**
         * Whether the region overlaps the anchor on the horizontal axis
         *
         * @public
         * @remarks
         * HTML Attribute: horizontal-inset
         */
        this.horizontalInset = false;
        /**
         * Defines how the width of the region is calculated
         *
         * @public
         * @remarks
         * HTML Attribute: horizontal-scaling
         */
        this.horizontalScaling = "content";
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
        this.verticalPositioningMode = "uncontrolled";
        /**
         * The default vertical position of the region relative to the anchor element
         *
         * @public
         * @remarks
         * HTML Attribute: vertical-default-position
         */
        this.verticalDefaultPosition = "unset";
        /**
         * Whether the region remains in the viewport (ie. detaches from the anchor) on the vertical axis
         *
         * @public
         * @remarks
         * HTML Attribute: vertical-viewport-lock
         */
        this.verticalViewportLock = false;
        /**
         * Whether the region overlaps the anchor on the vertical axis
         *
         * @public
         * @remarks
         * HTML Attribute: vertical-inset
         */
        this.verticalInset = false;
        /**
         * Defines how the height of the region is calculated
         *
         * @public
         * @remarks
         * HTML Attribute: vertical-scaling
         */
        this.verticalScaling = "content";
        /**
         * Whether the region is positioned using css "position: fixed".
         * Otherwise the region uses "position: absolute".
         * Fixed placement allows the region to break out of parent containers,
         *
         * @public
         * @remarks
         * HTML Attribute: fixed-placement
         */
        this.fixedPlacement = false;
        /**
         * Defines what triggers the anchored region to revaluate positioning
         *
         * @public
         * @remarks
         * HTML Attribute: auto-update-mode
         */
        this.autoUpdateMode = "anchor";
        /**
         * The HTML element being used as the anchor
         *
         * @public
         */
        this.anchorElement = null;
        /**
         * The HTML element being used as the viewport
         *
         * @public
         */
        this.viewportElement = null;
        /**
         * indicates that an initial positioning pass on layout has completed
         *
         * @internal
         */
        this.initialLayoutComplete = false;
        this.resizeDetector = null;
        /**
         * base offsets between the positioner's base position and the anchor's
         */
        this.baseHorizontalOffset = 0;
        this.baseVerticalOffset = 0;
        this.pendingPositioningUpdate = false;
        this.pendingReset = false;
        this.currentDirection = Direction.ltr;
        this.regionVisible = false;
        // indicates that a layout update should occur even if geometry has not changed
        // used to ensure some attribute changes are applied
        this.forceUpdate = false;
        // defines how big a difference in pixels there must be between states to
        // justify a layout update that affects the dom (prevents repeated sub-pixel corrections)
        this.updateThreshold = 0.5;
        /**
         * update position
         */
        this.update = () => {
            if (!this.pendingPositioningUpdate) {
                this.requestPositionUpdates();
            }
        };
        /**
         * starts observers
         */
        this.startObservers = () => {
            this.stopObservers();
            if (this.anchorElement === null) {
                return;
            }
            this.requestPositionUpdates();
            if (this.resizeDetector !== null) {
                this.resizeDetector.observe(this.anchorElement);
                this.resizeDetector.observe(this);
            }
        };
        /**
         * get position updates
         */
        this.requestPositionUpdates = () => {
            if (this.anchorElement === null || this.pendingPositioningUpdate) {
                return;
            }
            AnchoredRegion.intersectionService.requestPosition(this, this.handleIntersection);
            AnchoredRegion.intersectionService.requestPosition(this.anchorElement, this.handleIntersection);
            if (this.viewportElement !== null) {
                AnchoredRegion.intersectionService.requestPosition(this.viewportElement, this.handleIntersection);
            }
            this.pendingPositioningUpdate = true;
        };
        /**
         * stops observers
         */
        this.stopObservers = () => {
            if (this.pendingPositioningUpdate) {
                this.pendingPositioningUpdate = false;
                AnchoredRegion.intersectionService.cancelRequestPosition(this, this.handleIntersection);
                if (this.anchorElement !== null) {
                    AnchoredRegion.intersectionService.cancelRequestPosition(this.anchorElement, this.handleIntersection);
                }
                if (this.viewportElement !== null) {
                    AnchoredRegion.intersectionService.cancelRequestPosition(this.viewportElement, this.handleIntersection);
                }
            }
            if (this.resizeDetector !== null) {
                this.resizeDetector.disconnect();
            }
        };
        /**
         * Gets the viewport element by id, or defaults to document root
         */
        this.getViewport = () => {
            if (typeof this.viewport !== "string" || this.viewport === "") {
                return document.documentElement;
            }
            return document.getElementById(this.viewport);
        };
        /**
         *  Gets the anchor element by id
         */
        this.getAnchor = () => {
            return document.getElementById(this.anchor);
        };
        /**
         *  Handle intersections
         */
        this.handleIntersection = (entries) => {
            if (!this.pendingPositioningUpdate) {
                return;
            }
            this.pendingPositioningUpdate = false;
            if (!this.applyIntersectionEntries(entries)) {
                return;
            }
            this.updateLayout();
        };
        /**
         *  iterate through intersection entries and apply data
         */
        this.applyIntersectionEntries = (entries) => {
            const regionEntry = entries.find(x => x.target === this);
            const anchorEntry = entries.find(x => x.target === this.anchorElement);
            const viewportEntry = entries.find(x => x.target === this.viewportElement);
            if (regionEntry === undefined ||
                viewportEntry === undefined ||
                anchorEntry === undefined) {
                return false;
            }
            // don't update the dom unless there is a significant difference in rect positions
            if (!this.regionVisible ||
                this.forceUpdate ||
                this.regionRect === undefined ||
                this.anchorRect === undefined ||
                this.viewportRect === undefined ||
                this.isRectDifferent(this.anchorRect, anchorEntry.boundingClientRect) ||
                this.isRectDifferent(this.viewportRect, viewportEntry.boundingClientRect) ||
                this.isRectDifferent(this.regionRect, regionEntry.boundingClientRect)) {
                this.regionRect = regionEntry.boundingClientRect;
                this.anchorRect = anchorEntry.boundingClientRect;
                if (this.viewportElement === document.documentElement) {
                    this.viewportRect = new DOMRectReadOnly(viewportEntry.boundingClientRect.x +
                        document.documentElement.scrollLeft, viewportEntry.boundingClientRect.y +
                        document.documentElement.scrollTop, viewportEntry.boundingClientRect.width, viewportEntry.boundingClientRect.height);
                }
                else {
                    this.viewportRect = viewportEntry.boundingClientRect;
                }
                this.updateRegionOffset();
                this.forceUpdate = false;
                return true;
            }
            return false;
        };
        /**
         *  Update the offset values
         */
        this.updateRegionOffset = () => {
            if (this.anchorRect && this.regionRect) {
                this.baseHorizontalOffset =
                    this.baseHorizontalOffset +
                        (this.anchorRect.left - this.regionRect.left) +
                        (this.translateX - this.baseHorizontalOffset);
                this.baseVerticalOffset =
                    this.baseVerticalOffset +
                        (this.anchorRect.top - this.regionRect.top) +
                        (this.translateY - this.baseVerticalOffset);
            }
        };
        /**
         *  compare rects to see if there is enough change to justify a DOM update
         */
        this.isRectDifferent = (rectA, rectB) => {
            if (Math.abs(rectA.top - rectB.top) > this.updateThreshold ||
                Math.abs(rectA.right - rectB.right) > this.updateThreshold ||
                Math.abs(rectA.bottom - rectB.bottom) > this.updateThreshold ||
                Math.abs(rectA.left - rectB.left) > this.updateThreshold) {
                return true;
            }
            return false;
        };
        /**
         *  Handle resize events
         */
        this.handleResize = (entries) => {
            this.update();
        };
        /**
         * resets the component
         */
        this.reset = () => {
            if (!this.pendingReset) {
                return;
            }
            this.pendingReset = false;
            if (this.anchorElement === null) {
                this.anchorElement = this.getAnchor();
            }
            if (this.viewportElement === null) {
                this.viewportElement = this.getViewport();
            }
            this.currentDirection = getDirection(this);
            this.startObservers();
        };
        /**
         *  Recalculate layout related state values
         */
        this.updateLayout = () => {
            let desiredVerticalPosition = undefined;
            let desiredHorizontalPosition = undefined;
            if (this.horizontalPositioningMode !== "uncontrolled") {
                const horizontalOptions = this.getPositioningOptions(this.horizontalInset);
                if (this.horizontalDefaultPosition === "center") {
                    desiredHorizontalPosition = "center";
                }
                else if (this.horizontalDefaultPosition !== "unset") {
                    let dirCorrectedHorizontalDefaultPosition = this
                        .horizontalDefaultPosition;
                    if (dirCorrectedHorizontalDefaultPosition === "start" ||
                        dirCorrectedHorizontalDefaultPosition === "end") {
                        // if direction changes we reset the layout
                        const newDirection = getDirection(this);
                        if (newDirection !== this.currentDirection) {
                            this.currentDirection = newDirection;
                            this.initialize();
                            return;
                        }
                        if (this.currentDirection === Direction.ltr) {
                            dirCorrectedHorizontalDefaultPosition =
                                dirCorrectedHorizontalDefaultPosition === "start"
                                    ? "left"
                                    : "right";
                        }
                        else {
                            dirCorrectedHorizontalDefaultPosition =
                                dirCorrectedHorizontalDefaultPosition === "start"
                                    ? "right"
                                    : "left";
                        }
                    }
                    switch (dirCorrectedHorizontalDefaultPosition) {
                        case "left":
                            desiredHorizontalPosition = this.horizontalInset
                                ? "insetStart"
                                : "start";
                            break;
                        case "right":
                            desiredHorizontalPosition = this.horizontalInset
                                ? "insetEnd"
                                : "end";
                            break;
                    }
                }
                const horizontalThreshold = this.horizontalThreshold !== undefined
                    ? this.horizontalThreshold
                    : this.regionRect !== undefined
                        ? this.regionRect.width
                        : 0;
                const anchorLeft = this.anchorRect !== undefined ? this.anchorRect.left : 0;
                const anchorRight = this.anchorRect !== undefined ? this.anchorRect.right : 0;
                const anchorWidth = this.anchorRect !== undefined ? this.anchorRect.width : 0;
                const viewportLeft = this.viewportRect !== undefined ? this.viewportRect.left : 0;
                const viewportRight = this.viewportRect !== undefined ? this.viewportRect.right : 0;
                if (desiredHorizontalPosition === undefined ||
                    (!(this.horizontalPositioningMode === "locktodefault") &&
                        this.getAvailableSpace(desiredHorizontalPosition, anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight) < horizontalThreshold)) {
                    desiredHorizontalPosition =
                        this.getAvailableSpace(horizontalOptions[0], anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight) >
                            this.getAvailableSpace(horizontalOptions[1], anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight)
                            ? horizontalOptions[0]
                            : horizontalOptions[1];
                }
            }
            if (this.verticalPositioningMode !== "uncontrolled") {
                const verticalOptions = this.getPositioningOptions(this.verticalInset);
                if (this.verticalDefaultPosition === "center") {
                    desiredVerticalPosition = "center";
                }
                else if (this.verticalDefaultPosition !== "unset") {
                    switch (this.verticalDefaultPosition) {
                        case "top":
                            desiredVerticalPosition = this.verticalInset
                                ? "insetStart"
                                : "start";
                            break;
                        case "bottom":
                            desiredVerticalPosition = this.verticalInset ? "insetEnd" : "end";
                            break;
                    }
                }
                const verticalThreshold = this.verticalThreshold !== undefined
                    ? this.verticalThreshold
                    : this.regionRect !== undefined
                        ? this.regionRect.height
                        : 0;
                const anchorTop = this.anchorRect !== undefined ? this.anchorRect.top : 0;
                const anchorBottom = this.anchorRect !== undefined ? this.anchorRect.bottom : 0;
                const anchorHeight = this.anchorRect !== undefined ? this.anchorRect.height : 0;
                const viewportTop = this.viewportRect !== undefined ? this.viewportRect.top : 0;
                const viewportBottom = this.viewportRect !== undefined ? this.viewportRect.bottom : 0;
                if (desiredVerticalPosition === undefined ||
                    (!(this.verticalPositioningMode === "locktodefault") &&
                        this.getAvailableSpace(desiredVerticalPosition, anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom) < verticalThreshold)) {
                    desiredVerticalPosition =
                        this.getAvailableSpace(verticalOptions[0], anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom) >
                            this.getAvailableSpace(verticalOptions[1], anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom)
                            ? verticalOptions[0]
                            : verticalOptions[1];
                }
            }
            const nextPositionerDimension = this.getNextRegionDimension(desiredHorizontalPosition, desiredVerticalPosition);
            const positionChanged = this.horizontalPosition !== desiredHorizontalPosition ||
                this.verticalPosition !== desiredVerticalPosition;
            this.setHorizontalPosition(desiredHorizontalPosition, nextPositionerDimension);
            this.setVerticalPosition(desiredVerticalPosition, nextPositionerDimension);
            this.updateRegionStyle();
            if (!this.initialLayoutComplete) {
                this.initialLayoutComplete = true;
                this.requestPositionUpdates();
                return;
            }
            if (!this.regionVisible) {
                this.regionVisible = true;
                this.style.removeProperty("pointer-events");
                this.style.removeProperty("opacity");
                this.classList.toggle("loaded", true);
                this.$emit("loaded", this, { bubbles: false });
            }
            this.updatePositionClasses();
            if (positionChanged) {
                // emit change event
                this.$emit("positionchange", this, { bubbles: false });
            }
        };
        /**
         *  Updates the style string applied to the region element as well as the css classes attached
         *  to the root element
         */
        this.updateRegionStyle = () => {
            this.style.width = this.regionWidth;
            this.style.height = this.regionHeight;
            this.style.transform = `translate(${this.translateX}px, ${this.translateY}px)`;
        };
        /**
         *  Updates the css classes that reflect the current position of the element
         */
        this.updatePositionClasses = () => {
            this.classList.toggle("top", this.verticalPosition === "start");
            this.classList.toggle("bottom", this.verticalPosition === "end");
            this.classList.toggle("inset-top", this.verticalPosition === "insetStart");
            this.classList.toggle("inset-bottom", this.verticalPosition === "insetEnd");
            this.classList.toggle("vertical-center", this.verticalPosition === "center");
            this.classList.toggle("left", this.horizontalPosition === "start");
            this.classList.toggle("right", this.horizontalPosition === "end");
            this.classList.toggle("inset-left", this.horizontalPosition === "insetStart");
            this.classList.toggle("inset-right", this.horizontalPosition === "insetEnd");
            this.classList.toggle("horizontal-center", this.horizontalPosition === "center");
        };
        /**
         * Get horizontal positioning state based on desired position
         */
        this.setHorizontalPosition = (desiredHorizontalPosition, nextPositionerDimension) => {
            if (desiredHorizontalPosition === undefined ||
                this.regionRect === undefined ||
                this.anchorRect === undefined ||
                this.viewportRect === undefined) {
                return;
            }
            let nextRegionWidth = 0;
            switch (this.horizontalScaling) {
                case "anchor":
                case "fill":
                    nextRegionWidth = nextPositionerDimension.width;
                    this.regionWidth = `${nextRegionWidth}px`;
                    break;
                case "content":
                    nextRegionWidth = this.regionRect.width;
                    this.regionWidth = "unset";
                    break;
            }
            let sizeDelta = 0;
            switch (desiredHorizontalPosition) {
                case "start":
                    this.translateX = this.baseHorizontalOffset - nextRegionWidth;
                    if (this.horizontalViewportLock &&
                        this.anchorRect.left > this.viewportRect.right) {
                        this.translateX =
                            this.translateX -
                                (this.anchorRect.left - this.viewportRect.right);
                    }
                    break;
                case "insetStart":
                    this.translateX =
                        this.baseHorizontalOffset - nextRegionWidth + this.anchorRect.width;
                    if (this.horizontalViewportLock &&
                        this.anchorRect.right > this.viewportRect.right) {
                        this.translateX =
                            this.translateX -
                                (this.anchorRect.right - this.viewportRect.right);
                    }
                    break;
                case "insetEnd":
                    this.translateX = this.baseHorizontalOffset;
                    if (this.horizontalViewportLock &&
                        this.anchorRect.left < this.viewportRect.left) {
                        this.translateX =
                            this.translateX - (this.anchorRect.left - this.viewportRect.left);
                    }
                    break;
                case "end":
                    this.translateX = this.baseHorizontalOffset + this.anchorRect.width;
                    if (this.horizontalViewportLock &&
                        this.anchorRect.right < this.viewportRect.left) {
                        this.translateX =
                            this.translateX -
                                (this.anchorRect.right - this.viewportRect.left);
                    }
                    break;
                case "center":
                    sizeDelta = (this.anchorRect.width - nextRegionWidth) / 2;
                    this.translateX = this.baseHorizontalOffset + sizeDelta;
                    if (this.horizontalViewportLock) {
                        const regionLeft = this.anchorRect.left + sizeDelta;
                        const regionRight = this.anchorRect.right - sizeDelta;
                        if (regionLeft < this.viewportRect.left &&
                            !(regionRight > this.viewportRect.right)) {
                            this.translateX =
                                this.translateX - (regionLeft - this.viewportRect.left);
                        }
                        else if (regionRight > this.viewportRect.right &&
                            !(regionLeft < this.viewportRect.left)) {
                            this.translateX =
                                this.translateX - (regionRight - this.viewportRect.right);
                        }
                    }
                    break;
            }
            this.horizontalPosition = desiredHorizontalPosition;
        };
        /**
         * Set vertical positioning state based on desired position
         */
        this.setVerticalPosition = (desiredVerticalPosition, nextPositionerDimension) => {
            if (desiredVerticalPosition === undefined ||
                this.regionRect === undefined ||
                this.anchorRect === undefined ||
                this.viewportRect === undefined) {
                return;
            }
            let nextRegionHeight = 0;
            switch (this.verticalScaling) {
                case "anchor":
                case "fill":
                    nextRegionHeight = nextPositionerDimension.height;
                    this.regionHeight = `${nextRegionHeight}px`;
                    break;
                case "content":
                    nextRegionHeight = this.regionRect.height;
                    this.regionHeight = "unset";
                    break;
            }
            let sizeDelta = 0;
            switch (desiredVerticalPosition) {
                case "start":
                    this.translateY = this.baseVerticalOffset - nextRegionHeight;
                    if (this.verticalViewportLock &&
                        this.anchorRect.top > this.viewportRect.bottom) {
                        this.translateY =
                            this.translateY -
                                (this.anchorRect.top - this.viewportRect.bottom);
                    }
                    break;
                case "insetStart":
                    this.translateY =
                        this.baseVerticalOffset - nextRegionHeight + this.anchorRect.height;
                    if (this.verticalViewportLock &&
                        this.anchorRect.bottom > this.viewportRect.bottom) {
                        this.translateY =
                            this.translateY -
                                (this.anchorRect.bottom - this.viewportRect.bottom);
                    }
                    break;
                case "insetEnd":
                    this.translateY = this.baseVerticalOffset;
                    if (this.verticalViewportLock &&
                        this.anchorRect.top < this.viewportRect.top) {
                        this.translateY =
                            this.translateY - (this.anchorRect.top - this.viewportRect.top);
                    }
                    break;
                case "end":
                    this.translateY = this.baseVerticalOffset + this.anchorRect.height;
                    if (this.verticalViewportLock &&
                        this.anchorRect.bottom < this.viewportRect.top) {
                        this.translateY =
                            this.translateY -
                                (this.anchorRect.bottom - this.viewportRect.top);
                    }
                    break;
                case "center":
                    sizeDelta = (this.anchorRect.height - nextRegionHeight) / 2;
                    this.translateY = this.baseVerticalOffset + sizeDelta;
                    if (this.verticalViewportLock) {
                        const regionTop = this.anchorRect.top + sizeDelta;
                        const regionBottom = this.anchorRect.bottom - sizeDelta;
                        if (regionTop < this.viewportRect.top &&
                            !(regionBottom > this.viewportRect.bottom)) {
                            this.translateY =
                                this.translateY - (regionTop - this.viewportRect.top);
                        }
                        else if (regionBottom > this.viewportRect.bottom &&
                            !(regionTop < this.viewportRect.top)) {
                            this.translateY =
                                this.translateY - (regionBottom - this.viewportRect.bottom);
                        }
                    }
            }
            this.verticalPosition = desiredVerticalPosition;
        };
        /**
         *  Get available positions based on positioning mode
         */
        this.getPositioningOptions = (inset) => {
            if (inset) {
                return ["insetStart", "insetEnd"];
            }
            return ["start", "end"];
        };
        /**
         *  Get the space available for a particular relative position
         */
        this.getAvailableSpace = (positionOption, anchorStart, anchorEnd, anchorSpan, viewportStart, viewportEnd) => {
            const spaceStart = anchorStart - viewportStart;
            const spaceEnd = viewportEnd - (anchorStart + anchorSpan);
            switch (positionOption) {
                case "start":
                    return spaceStart;
                case "insetStart":
                    return spaceStart + anchorSpan;
                case "insetEnd":
                    return spaceEnd + anchorSpan;
                case "end":
                    return spaceEnd;
                case "center":
                    return Math.min(spaceStart, spaceEnd) * 2 + anchorSpan;
            }
        };
        /**
         * Get region dimensions
         */
        this.getNextRegionDimension = (desiredHorizontalPosition, desiredVerticalPosition) => {
            const newRegionDimension = {
                height: this.regionRect !== undefined ? this.regionRect.height : 0,
                width: this.regionRect !== undefined ? this.regionRect.width : 0,
            };
            if (desiredHorizontalPosition !== undefined &&
                this.horizontalScaling === "fill") {
                newRegionDimension.width = this.getAvailableSpace(desiredHorizontalPosition, this.anchorRect !== undefined ? this.anchorRect.left : 0, this.anchorRect !== undefined ? this.anchorRect.right : 0, this.anchorRect !== undefined ? this.anchorRect.width : 0, this.viewportRect !== undefined ? this.viewportRect.left : 0, this.viewportRect !== undefined ? this.viewportRect.right : 0);
            }
            else if (this.horizontalScaling === "anchor") {
                newRegionDimension.width =
                    this.anchorRect !== undefined ? this.anchorRect.width : 0;
            }
            if (desiredVerticalPosition !== undefined && this.verticalScaling === "fill") {
                newRegionDimension.height = this.getAvailableSpace(desiredVerticalPosition, this.anchorRect !== undefined ? this.anchorRect.top : 0, this.anchorRect !== undefined ? this.anchorRect.bottom : 0, this.anchorRect !== undefined ? this.anchorRect.height : 0, this.viewportRect !== undefined ? this.viewportRect.top : 0, this.viewportRect !== undefined ? this.viewportRect.bottom : 0);
            }
            else if (this.verticalScaling === "anchor") {
                newRegionDimension.height =
                    this.anchorRect !== undefined ? this.anchorRect.height : 0;
            }
            return newRegionDimension;
        };
        /**
         * starts event listeners that can trigger auto updating
         */
        this.startAutoUpdateEventListeners = () => {
            window.addEventListener(eventResize, this.update, { passive: true });
            window.addEventListener(eventScroll, this.update, {
                passive: true,
                capture: true,
            });
            if (this.resizeDetector !== null && this.viewportElement !== null) {
                this.resizeDetector.observe(this.viewportElement);
            }
        };
        /**
         * stops event listeners that can trigger auto updating
         */
        this.stopAutoUpdateEventListeners = () => {
            window.removeEventListener(eventResize, this.update);
            window.removeEventListener(eventScroll, this.update);
            if (this.resizeDetector !== null && this.viewportElement !== null) {
                this.resizeDetector.unobserve(this.viewportElement);
            }
        };
    }
    anchorChanged() {
        if (this.initialLayoutComplete) {
            this.anchorElement = this.getAnchor();
        }
    }
    viewportChanged() {
        if (this.initialLayoutComplete) {
            this.viewportElement = this.getViewport();
        }
    }
    horizontalPositioningModeChanged() {
        this.requestReset();
    }
    horizontalDefaultPositionChanged() {
        this.updateForAttributeChange();
    }
    horizontalViewportLockChanged() {
        this.updateForAttributeChange();
    }
    horizontalInsetChanged() {
        this.updateForAttributeChange();
    }
    horizontalThresholdChanged() {
        this.updateForAttributeChange();
    }
    horizontalScalingChanged() {
        this.updateForAttributeChange();
    }
    verticalPositioningModeChanged() {
        this.requestReset();
    }
    verticalDefaultPositionChanged() {
        this.updateForAttributeChange();
    }
    verticalViewportLockChanged() {
        this.updateForAttributeChange();
    }
    verticalInsetChanged() {
        this.updateForAttributeChange();
    }
    verticalThresholdChanged() {
        this.updateForAttributeChange();
    }
    verticalScalingChanged() {
        this.updateForAttributeChange();
    }
    fixedPlacementChanged() {
        if (this.$fastController.isConnected &&
            this.initialLayoutComplete) {
            this.initialize();
        }
    }
    autoUpdateModeChanged(prevMode, newMode) {
        if (this.$fastController.isConnected &&
            this.initialLayoutComplete) {
            if (prevMode === "auto") {
                this.stopAutoUpdateEventListeners();
            }
            if (newMode === "auto") {
                this.startAutoUpdateEventListeners();
            }
        }
    }
    anchorElementChanged() {
        this.requestReset();
    }
    viewportElementChanged() {
        if (this.$fastController.isConnected &&
            this.initialLayoutComplete) {
            this.initialize();
        }
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        if (this.autoUpdateMode === "auto") {
            this.startAutoUpdateEventListeners();
        }
        this.initialize();
    }
    /**
     * @internal
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.autoUpdateMode === "auto") {
            this.stopAutoUpdateEventListeners();
        }
        this.stopObservers();
        this.disconnectResizeDetector();
    }
    /**
     * @internal
     */
    adoptedCallback() {
        this.initialize();
    }
    /**
     * destroys the instance's resize observer
     */
    disconnectResizeDetector() {
        if (this.resizeDetector !== null) {
            this.resizeDetector.disconnect();
            this.resizeDetector = null;
        }
    }
    /**
     * initializes the instance's resize observer
     */
    initializeResizeDetector() {
        this.disconnectResizeDetector();
        this.resizeDetector = new window.ResizeObserver(this.handleResize);
    }
    /**
     * react to attribute changes that don't require a reset
     */
    updateForAttributeChange() {
        if (this.$fastController.isConnected &&
            this.initialLayoutComplete) {
            this.forceUpdate = true;
            this.update();
        }
    }
    /**
     * fully initializes the component
     */
    initialize() {
        this.initializeResizeDetector();
        if (this.anchorElement === null) {
            this.anchorElement = this.getAnchor();
        }
        this.requestReset();
    }
    /**
     * Request a reset if there are currently no open requests
     */
    requestReset() {
        if (this.$fastController.isConnected &&
            this.pendingReset === false) {
            this.setInitialState();
            DOM.queueUpdate(() => this.reset());
            this.pendingReset = true;
        }
    }
    /**
     * sets the starting configuration for component internal values
     */
    setInitialState() {
        this.initialLayoutComplete = false;
        this.regionVisible = false;
        this.translateX = 0;
        this.translateY = 0;
        this.baseHorizontalOffset = 0;
        this.baseVerticalOffset = 0;
        this.viewportRect = undefined;
        this.regionRect = undefined;
        this.anchorRect = undefined;
        this.verticalPosition = undefined;
        this.horizontalPosition = undefined;
        this.style.opacity = "0";
        this.style.pointerEvents = "none";
        this.forceUpdate = false;
        this.style.position = this.fixedPlacement ? "fixed" : "absolute";
        this.updatePositionClasses();
        this.updateRegionStyle();
    }
}
AnchoredRegion.intersectionService = new IntersectionService();
__decorate([
    attr
], AnchoredRegion.prototype, "anchor", void 0);
__decorate([
    attr
], AnchoredRegion.prototype, "viewport", void 0);
__decorate([
    attr({ attribute: "horizontal-positioning-mode" })
], AnchoredRegion.prototype, "horizontalPositioningMode", void 0);
__decorate([
    attr({ attribute: "horizontal-default-position" })
], AnchoredRegion.prototype, "horizontalDefaultPosition", void 0);
__decorate([
    attr({ attribute: "horizontal-viewport-lock", mode: "boolean" })
], AnchoredRegion.prototype, "horizontalViewportLock", void 0);
__decorate([
    attr({ attribute: "horizontal-inset", mode: "boolean" })
], AnchoredRegion.prototype, "horizontalInset", void 0);
__decorate([
    attr({ attribute: "horizontal-threshold" })
], AnchoredRegion.prototype, "horizontalThreshold", void 0);
__decorate([
    attr({ attribute: "horizontal-scaling" })
], AnchoredRegion.prototype, "horizontalScaling", void 0);
__decorate([
    attr({ attribute: "vertical-positioning-mode" })
], AnchoredRegion.prototype, "verticalPositioningMode", void 0);
__decorate([
    attr({ attribute: "vertical-default-position" })
], AnchoredRegion.prototype, "verticalDefaultPosition", void 0);
__decorate([
    attr({ attribute: "vertical-viewport-lock", mode: "boolean" })
], AnchoredRegion.prototype, "verticalViewportLock", void 0);
__decorate([
    attr({ attribute: "vertical-inset", mode: "boolean" })
], AnchoredRegion.prototype, "verticalInset", void 0);
__decorate([
    attr({ attribute: "vertical-threshold" })
], AnchoredRegion.prototype, "verticalThreshold", void 0);
__decorate([
    attr({ attribute: "vertical-scaling" })
], AnchoredRegion.prototype, "verticalScaling", void 0);
__decorate([
    attr({ attribute: "fixed-placement", mode: "boolean" })
], AnchoredRegion.prototype, "fixedPlacement", void 0);
__decorate([
    attr({ attribute: "auto-update-mode" })
], AnchoredRegion.prototype, "autoUpdateMode", void 0);
__decorate([
    observable
], AnchoredRegion.prototype, "anchorElement", void 0);
__decorate([
    observable
], AnchoredRegion.prototype, "viewportElement", void 0);
__decorate([
    observable
], AnchoredRegion.prototype, "initialLayoutComplete", void 0);
