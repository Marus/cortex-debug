/**
 * Building blocks - partial configs
 */
/**
 * A region that matches the size and position of the anchor horizontally
 */
const horizontalAnchorOverlay = {
    horizontalDefaultPosition: "center",
    horizontalPositioningMode: "locktodefault",
    horizontalInset: false,
    horizontalScaling: "anchor",
};
/**
 * Exported configs
 */
/**
 * A region that always places itself above the anchor, has
 * a width to match the anchor, and is sized vertically by content
 *
 * @public
 */
export const FlyoutPosTop = Object.assign(Object.assign({}, horizontalAnchorOverlay), { verticalDefaultPosition: "top", verticalPositioningMode: "locktodefault", verticalInset: false, verticalScaling: "content" });
/**
 * A region that always places itself below the anchor, has
 * a width to match the anchor, and is sized vertically by content
 *
 * @public
 */
export const FlyoutPosBottom = Object.assign(Object.assign({}, horizontalAnchorOverlay), { verticalDefaultPosition: "bottom", verticalPositioningMode: "locktodefault", verticalInset: false, verticalScaling: "content" });
/**
 * A region that places itself above or below the anchor
 * based on available space, has a width to match the anchor,
 * and is sized vertically by content
 *
 * @public
 */
export const FlyoutPosTallest = Object.assign(Object.assign({}, horizontalAnchorOverlay), { verticalPositioningMode: "dynamic", verticalInset: false, verticalScaling: "content" });
/**
 * A region that always places itself above the anchor, has
 * a width to match the anchor, and is sized vertically by available space
 *
 * @public
 */
export const FlyoutPosTopFill = Object.assign(Object.assign({}, FlyoutPosTop), { verticalScaling: "fill" });
/**
 * A region that always places itself below the anchor, has
 * a width to match the anchor, and is sized vertically by available space
 *
 * @public
 */
export const FlyoutPosBottomFill = Object.assign(Object.assign({}, FlyoutPosBottom), { verticalScaling: "fill" });
/**
 * A region that places itself above or below the anchor
 * based on available space, has a width to match the anchor,
 * and is sized vertically by available space
 *
 * @public
 */
export const FlyoutPosTallestFill = Object.assign(Object.assign({}, FlyoutPosTallest), { verticalScaling: "fill" });
