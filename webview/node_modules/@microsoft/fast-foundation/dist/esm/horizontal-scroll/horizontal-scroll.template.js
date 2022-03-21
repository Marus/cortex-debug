import { elements, html, ref, slotted, when, } from "@microsoft/fast-element";
import { endSlotTemplate, startSlotTemplate } from "../patterns";
/**
 * @public
 */
export const horizontalScrollTemplate = (context, definition) => {
    var _a, _b;
    return html `
    <template
        class="horizontal-scroll"
        @keyup="${(x, c) => x.keyupHandler(c.event)}"
    >
        ${startSlotTemplate(context, definition)}
        <div class="scroll-area" part="scroll-area">
            <div
                class="scroll-view"
                part="scroll-view"
                @scroll="${x => x.scrolled()}"
                ${ref("scrollContainer")}
            >
                <div class="content-container" part="content-container" ${ref("content")}>
                    <slot
                        ${slotted({
        property: "scrollItems",
        filter: elements(),
    })}
                    ></slot>
                </div>
            </div>
            ${when(x => x.view !== "mobile", html `
                    <div
                        class="scroll scroll-prev"
                        part="scroll-prev"
                        ${ref("previousFlipperContainer")}
                    >
                        <div class="scroll-action" part="scroll-action-previous">
                            <slot name="previous-flipper">
                                ${definition.previousFlipper instanceof Function
        ? definition.previousFlipper(context, definition)
        : (_a = definition.previousFlipper) !== null && _a !== void 0 ? _a : ""}
                            </slot>
                        </div>
                    </div>
                    <div
                        class="scroll scroll-next"
                        part="scroll-next"
                        ${ref("nextFlipperContainer")}
                    >
                        <div class="scroll-action" part="scroll-action-next">
                            <slot name="next-flipper">
                                ${definition.nextFlipper instanceof Function
        ? definition.nextFlipper(context, definition)
        : (_b = definition.nextFlipper) !== null && _b !== void 0 ? _b : ""}
                            </slot>
                        </div>
                    </div>
                `)}
        </div>
        ${endSlotTemplate(context, definition)}
    </template>
`;
};
