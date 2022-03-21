import { __decorate } from "tslib";
import { attr, DOM, observable } from "@microsoft/fast-element";
import { Direction, keyEscape } from "@microsoft/fast-web-utilities";
import { getDirection } from "../utilities/";
import { FoundationElement } from "../foundation-element";
import { TooltipPosition } from "./tooltip.options";
export { TooltipPosition };
/**
 * An Tooltip Custom HTML Element.
 *
 * @public
 */
export class Tooltip extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * The id of the element the tooltip is anchored to
         *
         * @defaultValue - undefined
         * @public
         * HTML Attribute: anchor
         */
        this.anchor = "";
        /**
         * The delay in milliseconds before a tooltip is shown after a hover event
         *
         * @defaultValue - 300
         * @public
         * HTML Attribute: delay
         */
        this.delay = 300;
        /**
         * Controls when the tooltip updates its position, default is 'anchor' which only updates when
         * the anchor is resized.  'auto' will update on scroll/resize events.
         * Corresponds to anchored-region auto-update-mode.
         * @public
         * @remarks
         * HTML Attribute: auto-update-mode
         */
        this.autoUpdateMode = "anchor";
        /**
         * the html element currently being used as anchor.
         * Setting this directly overrides the anchor attribute.
         *
         * @public
         */
        this.anchorElement = null;
        /**
         * The current viewport element instance
         *
         * @internal
         */
        this.viewportElement = null;
        /**
         * @internal
         * @defaultValue "dynamic"
         */
        this.verticalPositioningMode = "dynamic";
        /**
         * @internal
         * @defaultValue "dynamic"
         */
        this.horizontalPositioningMode = "dynamic";
        /**
         * @internal
         */
        this.horizontalInset = "false";
        /**
         * @internal
         */
        this.verticalInset = "false";
        /**
         * @internal
         */
        this.horizontalScaling = "content";
        /**
         * @internal
         */
        this.verticalScaling = "content";
        /**
         * @internal
         */
        this.verticalDefaultPosition = undefined;
        /**
         * @internal
         */
        this.horizontalDefaultPosition = undefined;
        /**
         * @internal
         */
        this.tooltipVisible = false;
        /**
         * Track current direction to pass to the anchored region
         * updated when tooltip is shown
         *
         * @internal
         */
        this.currentDirection = Direction.ltr;
        /**
         * The timer that tracks delay time before the tooltip is shown on hover
         */
        this.showDelayTimer = null;
        /**
         * The timer that tracks delay time before the tooltip is hidden
         */
        this.hideDelayTimer = null;
        /**
         * Indicates whether the anchor is currently being hovered or has focus
         */
        this.isAnchorHoveredFocused = false;
        /**
         * Indicates whether the region is currently being hovered
         */
        this.isRegionHovered = false;
        /**
         * invoked when the anchored region's position relative to the anchor changes
         *
         * @internal
         */
        this.handlePositionChange = (ev) => {
            this.classList.toggle("top", this.region.verticalPosition === "start");
            this.classList.toggle("bottom", this.region.verticalPosition === "end");
            this.classList.toggle("inset-top", this.region.verticalPosition === "insetStart");
            this.classList.toggle("inset-bottom", this.region.verticalPosition === "insetEnd");
            this.classList.toggle("center-vertical", this.region.verticalPosition === "center");
            this.classList.toggle("left", this.region.horizontalPosition === "start");
            this.classList.toggle("right", this.region.horizontalPosition === "end");
            this.classList.toggle("inset-left", this.region.horizontalPosition === "insetStart");
            this.classList.toggle("inset-right", this.region.horizontalPosition === "insetEnd");
            this.classList.toggle("center-horizontal", this.region.horizontalPosition === "center");
        };
        /**
         * mouse enters region
         */
        this.handleRegionMouseOver = (ev) => {
            this.isRegionHovered = true;
        };
        /**
         * mouse leaves region
         */
        this.handleRegionMouseOut = (ev) => {
            this.isRegionHovered = false;
            this.startHideDelayTimer();
        };
        /**
         * mouse enters anchor
         */
        this.handleAnchorMouseOver = (ev) => {
            if (this.tooltipVisible) {
                // tooltip is already visible, just set the anchor hover flag
                this.isAnchorHoveredFocused = true;
                return;
            }
            this.startShowDelayTimer();
        };
        /**
         * mouse leaves anchor
         */
        this.handleAnchorMouseOut = (ev) => {
            this.isAnchorHoveredFocused = false;
            this.clearShowDelayTimer();
            this.startHideDelayTimer();
        };
        /**
         * anchor gets focus
         */
        this.handleAnchorFocusIn = (ev) => {
            this.startShowDelayTimer();
        };
        /**
         * anchor loses focus
         */
        this.handleAnchorFocusOut = (ev) => {
            this.isAnchorHoveredFocused = false;
            this.clearShowDelayTimer();
            this.startHideDelayTimer();
        };
        /**
         * starts the hide timer
         */
        this.startHideDelayTimer = () => {
            this.clearHideDelayTimer();
            if (!this.tooltipVisible) {
                return;
            }
            // allow 60 ms for account for pointer to move between anchor/tooltip
            // without hiding tooltip
            this.hideDelayTimer = window.setTimeout(() => {
                this.updateTooltipVisibility();
            }, 60);
        };
        /**
         * clears the hide delay
         */
        this.clearHideDelayTimer = () => {
            if (this.hideDelayTimer !== null) {
                clearTimeout(this.hideDelayTimer);
                this.hideDelayTimer = null;
            }
        };
        /**
         * starts the show timer if not currently running
         */
        this.startShowDelayTimer = () => {
            if (this.isAnchorHoveredFocused) {
                return;
            }
            if (this.delay > 1) {
                if (this.showDelayTimer === null)
                    this.showDelayTimer = window.setTimeout(() => {
                        this.startHover();
                    }, this.delay);
                return;
            }
            this.startHover();
        };
        /**
         * start hover
         */
        this.startHover = () => {
            this.isAnchorHoveredFocused = true;
            this.updateTooltipVisibility();
        };
        /**
         * clears the show delay
         */
        this.clearShowDelayTimer = () => {
            if (this.showDelayTimer !== null) {
                clearTimeout(this.showDelayTimer);
                this.showDelayTimer = null;
            }
        };
        /**
         *  Gets the anchor element by id
         */
        this.getAnchor = () => {
            const rootNode = this.getRootNode();
            if (rootNode instanceof ShadowRoot) {
                return rootNode.getElementById(this.anchor);
            }
            return document.getElementById(this.anchor);
        };
        /**
         * handles key down events to check for dismiss
         */
        this.handleDocumentKeydown = (e) => {
            if (!e.defaultPrevented && this.tooltipVisible) {
                switch (e.key) {
                    case keyEscape:
                        this.isAnchorHoveredFocused = false;
                        this.updateTooltipVisibility();
                        this.$emit("dismiss");
                        break;
                }
            }
        };
        /**
         * determines whether to show or hide the tooltip based on current state
         */
        this.updateTooltipVisibility = () => {
            if (this.visible === false) {
                this.hideTooltip();
            }
            else if (this.visible === true) {
                this.showTooltip();
                return;
            }
            else {
                if (this.isAnchorHoveredFocused || this.isRegionHovered) {
                    this.showTooltip();
                    return;
                }
                this.hideTooltip();
            }
        };
        /**
         * shows the tooltip
         */
        this.showTooltip = () => {
            if (this.tooltipVisible) {
                return;
            }
            this.currentDirection = getDirection(this);
            this.tooltipVisible = true;
            document.addEventListener("keydown", this.handleDocumentKeydown);
            DOM.queueUpdate(this.setRegionProps);
        };
        /**
         * hides the tooltip
         */
        this.hideTooltip = () => {
            if (!this.tooltipVisible) {
                return;
            }
            this.clearHideDelayTimer();
            if (this.region !== null && this.region !== undefined) {
                this.region.removeEventListener("positionchange", this.handlePositionChange);
                this.region.viewportElement = null;
                this.region.anchorElement = null;
                this.region.removeEventListener("mouseover", this.handleRegionMouseOver);
                this.region.removeEventListener("mouseout", this.handleRegionMouseOut);
            }
            document.removeEventListener("keydown", this.handleDocumentKeydown);
            this.tooltipVisible = false;
        };
        /**
         * updates the tooltip anchored region props after it has been
         * added to the DOM
         */
        this.setRegionProps = () => {
            if (!this.tooltipVisible) {
                return;
            }
            this.region.viewportElement = this.viewportElement;
            this.region.anchorElement = this.anchorElement;
            this.region.addEventListener("positionchange", this.handlePositionChange);
            this.region.addEventListener("mouseover", this.handleRegionMouseOver, {
                passive: true,
            });
            this.region.addEventListener("mouseout", this.handleRegionMouseOut, {
                passive: true,
            });
        };
    }
    visibleChanged() {
        if (this.$fastController.isConnected) {
            this.updateTooltipVisibility();
            this.updateLayout();
        }
    }
    anchorChanged() {
        if (this.$fastController.isConnected) {
            this.anchorElement = this.getAnchor();
        }
    }
    positionChanged() {
        if (this.$fastController.isConnected) {
            this.updateLayout();
        }
    }
    anchorElementChanged(oldValue) {
        if (this.$fastController.isConnected) {
            if (oldValue !== null && oldValue !== undefined) {
                oldValue.removeEventListener("mouseover", this.handleAnchorMouseOver);
                oldValue.removeEventListener("mouseout", this.handleAnchorMouseOut);
                oldValue.removeEventListener("focusin", this.handleAnchorFocusIn);
                oldValue.removeEventListener("focusout", this.handleAnchorFocusOut);
            }
            if (this.anchorElement !== null && this.anchorElement !== undefined) {
                this.anchorElement.addEventListener("mouseover", this.handleAnchorMouseOver, { passive: true });
                this.anchorElement.addEventListener("mouseout", this.handleAnchorMouseOut, { passive: true });
                this.anchorElement.addEventListener("focusin", this.handleAnchorFocusIn, {
                    passive: true,
                });
                this.anchorElement.addEventListener("focusout", this.handleAnchorFocusOut, { passive: true });
                const anchorId = this.anchorElement.id;
                if (this.anchorElement.parentElement !== null) {
                    this.anchorElement.parentElement
                        .querySelectorAll(":hover")
                        .forEach(element => {
                        if (element.id === anchorId) {
                            this.startShowDelayTimer();
                        }
                    });
                }
            }
            if (this.region !== null &&
                this.region !== undefined &&
                this.tooltipVisible) {
                this.region.anchorElement = this.anchorElement;
            }
            this.updateLayout();
        }
    }
    viewportElementChanged() {
        if (this.region !== null && this.region !== undefined) {
            this.region.viewportElement = this.viewportElement;
        }
        this.updateLayout();
    }
    connectedCallback() {
        super.connectedCallback();
        this.anchorElement = this.getAnchor();
        this.updateTooltipVisibility();
    }
    disconnectedCallback() {
        this.hideTooltip();
        this.clearShowDelayTimer();
        this.clearHideDelayTimer();
        super.disconnectedCallback();
    }
    /**
     * updated the properties being passed to the anchored region
     */
    updateLayout() {
        this.verticalPositioningMode = "locktodefault";
        this.horizontalPositioningMode = "locktodefault";
        switch (this.position) {
            case TooltipPosition.top:
            case TooltipPosition.bottom:
                this.verticalDefaultPosition = this.position;
                this.horizontalDefaultPosition = "center";
                break;
            case TooltipPosition.right:
            case TooltipPosition.left:
            case TooltipPosition.start:
            case TooltipPosition.end:
                this.verticalDefaultPosition = "center";
                this.horizontalDefaultPosition = this.position;
                break;
            case TooltipPosition.topLeft:
                this.verticalDefaultPosition = "top";
                this.horizontalDefaultPosition = "left";
                break;
            case TooltipPosition.topRight:
                this.verticalDefaultPosition = "top";
                this.horizontalDefaultPosition = "right";
                break;
            case TooltipPosition.bottomLeft:
                this.verticalDefaultPosition = "bottom";
                this.horizontalDefaultPosition = "left";
                break;
            case TooltipPosition.bottomRight:
                this.verticalDefaultPosition = "bottom";
                this.horizontalDefaultPosition = "right";
                break;
            case TooltipPosition.topStart:
                this.verticalDefaultPosition = "top";
                this.horizontalDefaultPosition = "start";
                break;
            case TooltipPosition.topEnd:
                this.verticalDefaultPosition = "top";
                this.horizontalDefaultPosition = "end";
                break;
            case TooltipPosition.bottomStart:
                this.verticalDefaultPosition = "bottom";
                this.horizontalDefaultPosition = "start";
                break;
            case TooltipPosition.bottomEnd:
                this.verticalDefaultPosition = "bottom";
                this.horizontalDefaultPosition = "end";
                break;
            default:
                this.verticalPositioningMode = "dynamic";
                this.horizontalPositioningMode = "dynamic";
                this.verticalDefaultPosition = void 0;
                this.horizontalDefaultPosition = "center";
                break;
        }
    }
}
__decorate([
    attr({ mode: "boolean" })
], Tooltip.prototype, "visible", void 0);
__decorate([
    attr
], Tooltip.prototype, "anchor", void 0);
__decorate([
    attr
], Tooltip.prototype, "delay", void 0);
__decorate([
    attr
], Tooltip.prototype, "position", void 0);
__decorate([
    attr({ attribute: "auto-update-mode" })
], Tooltip.prototype, "autoUpdateMode", void 0);
__decorate([
    attr({ attribute: "horizontal-viewport-lock" })
], Tooltip.prototype, "horizontalViewportLock", void 0);
__decorate([
    attr({ attribute: "vertical-viewport-lock" })
], Tooltip.prototype, "verticalViewportLock", void 0);
__decorate([
    observable
], Tooltip.prototype, "anchorElement", void 0);
__decorate([
    observable
], Tooltip.prototype, "viewportElement", void 0);
__decorate([
    observable
], Tooltip.prototype, "verticalPositioningMode", void 0);
__decorate([
    observable
], Tooltip.prototype, "horizontalPositioningMode", void 0);
__decorate([
    observable
], Tooltip.prototype, "horizontalInset", void 0);
__decorate([
    observable
], Tooltip.prototype, "verticalInset", void 0);
__decorate([
    observable
], Tooltip.prototype, "horizontalScaling", void 0);
__decorate([
    observable
], Tooltip.prototype, "verticalScaling", void 0);
__decorate([
    observable
], Tooltip.prototype, "verticalDefaultPosition", void 0);
__decorate([
    observable
], Tooltip.prototype, "horizontalDefaultPosition", void 0);
__decorate([
    observable
], Tooltip.prototype, "tooltipVisible", void 0);
__decorate([
    observable
], Tooltip.prototype, "currentDirection", void 0);
