import { __decorate } from "tslib";
import { uniqueId } from "@microsoft/fast-web-utilities";
import { observable } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * A List Picker Menu Custom HTML Element.
 *
 * @alpha
 */
export class PickerMenu extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * Children that are list items
         *
         * @internal
         */
        this.optionElements = [];
    }
    menuElementsChanged() {
        this.updateOptions();
    }
    headerElementsChanged() {
        this.updateOptions();
    }
    footerElementsChanged() {
        this.updateOptions();
    }
    updateOptions() {
        this.optionElements.splice(0, this.optionElements.length);
        this.addSlottedListItems(this.headerElements);
        this.addSlottedListItems(this.menuElements);
        this.addSlottedListItems(this.footerElements);
        this.$emit("optionsupdated", { bubbles: false });
    }
    addSlottedListItems(slotChildren) {
        if (slotChildren === undefined) {
            return;
        }
        slotChildren.forEach((child) => {
            if (child.nodeType === 1 && child.getAttribute("role") === "listitem") {
                child.id = child.id || uniqueId("option-");
                this.optionElements.push(child);
            }
        });
    }
}
__decorate([
    observable
], PickerMenu.prototype, "menuElements", void 0);
__decorate([
    observable
], PickerMenu.prototype, "headerElements", void 0);
__decorate([
    observable
], PickerMenu.prototype, "footerElements", void 0);
__decorate([
    observable
], PickerMenu.prototype, "suggestionsAvailableText", void 0);
