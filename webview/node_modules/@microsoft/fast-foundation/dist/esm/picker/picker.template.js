import { html, ref, when } from "@microsoft/fast-element";
import { AnchoredRegion } from "../anchored-region";
import { PickerMenu } from "./picker-menu";
import { PickerMenuOption } from "./picker-menu-option";
import { PickerList } from "./picker-list";
import { PickerListItem } from "./picker-list-item";
function createDefaultListItemTemplate(context) {
    const pickerListItemTag = context.tagFor(PickerListItem);
    return html `
    <${pickerListItemTag}
        value="${x => x}"
        :contentsTemplate="${(x, c) => c.parent.listItemContentsTemplate}"
    >
    </${pickerListItemTag}>
    `;
}
function createDefaultMenuOptionTemplate(context) {
    const pickerMenuOptionTag = context.tagFor(PickerMenuOption);
    return html `
    <${pickerMenuOptionTag}
        value="${x => x}"
        :contentsTemplate="${(x, c) => c.parent.menuOptionContentsTemplate}"
    >
    </${pickerMenuOptionTag}>
    `;
}
/**
 * The template for the List Picker component.
 * @public
 */
export const pickerTemplate = (context, definition) => {
    const anchoredRegionTag = context.tagFor(AnchoredRegion);
    const pickerMenuTag = context.tagFor(PickerMenu);
    const pickerListTag = context.tagFor(PickerList);
    const progressRingTag = context.tagFor(PickerList);
    const defaultListItemTemplate = createDefaultListItemTemplate(context);
    const defaultMenuOptionTemplate = createDefaultMenuOptionTemplate(context);
    return html `
        <template
            :selectedListTag="${() => pickerListTag}"
            :menuTag="${() => pickerMenuTag}"
            :defaultListItemTemplate="${defaultListItemTemplate}"
            :defaultMenuOptionTemplate="${defaultMenuOptionTemplate}"
            @focusin="${(x, c) => x.handleFocusIn(c.event)}"
            @focusout="${(x, c) => x.handleFocusOut(c.event)}"
            @keydown="${(x, c) => x.handleKeyDown(c.event)}"
            @pickeriteminvoked="${(x, c) => x.handleItemInvoke(c.event)}"
            @pickeroptioninvoked="${(x, c) => x.handleOptionInvoke(c.event)}"
        >
            <slot name="list-region"></slot>

            ${when(x => x.flyoutOpen, html `
                <${anchoredRegionTag}
                    class="region"
                    part="region"
                    auto-update-mode="${x => x.menuConfig.autoUpdateMode}"
                    fixed-placement="${x => x.menuConfig.fixedPlacement}"
                    vertical-positioning-mode="${x => x.menuConfig.verticalPositioningMode}"
                    vertical-default-position="${x => x.menuConfig.verticalDefaultPosition}"
                    vertical-scaling="${x => x.menuConfig.verticalScaling}"
                    vertical-inset="${x => x.menuConfig.verticalInset}"
                    vertical-viewport-lock="${x => x.menuConfig.verticalViewportLock}"
                    horizontal-positioning-mode="${x => x.menuConfig.horizontalPositioningMode}"
                    horizontal-default-position="${x => x.menuConfig.horizontalDefaultPosition}"
                    horizontal-scaling="${x => x.menuConfig.horizontalScaling}"
                    horizontal-inset="${x => x.menuConfig.horizontalInset}"
                    horizontal-viewport-lock="${x => x.menuConfig.horizontalViewportLock}"
                    @loaded="${(x, c) => x.handleRegionLoaded(c.event)}"
                    ${ref("region")}
                >
                    ${when(x => !x.showNoOptions && !x.showLoading, html `
                            <slot name="menu-region"></slot>
                        `)}
                    ${when(x => x.showNoOptions && !x.showLoading, html `
                            <div class="no-options-display" part="no-options-display">
                                <slot name="no-options-region">
                                    ${x => x.noSuggestionsText}
                                </slot>
                            </div>
                        `)}
                    ${when(x => x.showLoading, html `
                            <div class="loading-display" part="loading-display">
                                <slot name="loading-region">
                                    <${progressRingTag}
                                        part="loading-progress"
                                        class="loading-progress
                                        slot="loading-region"
                                    ></${progressRingTag}>
                                        ${x => x.loadingText}
                                </slot>
                            </div>
                        `)}
                </${anchoredRegionTag}>
            `)}
        </template>
    `;
};
