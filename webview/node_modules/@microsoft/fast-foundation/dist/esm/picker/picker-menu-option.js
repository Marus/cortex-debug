import { __decorate } from "tslib";
import { attr, html, observable } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
const defaultContentsTemplate = html `
    <template>
        ${x => x.value}
    </template>
`;
/**
 * A picker list item Custom HTML Element.
 *
 * @alpha
 */
export class PickerMenuOption extends FoundationElement {
    contentsTemplateChanged() {
        if (this.$fastController.isConnected) {
            this.updateView();
        }
    }
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.updateView();
    }
    /**
     * @internal
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        this.disconnectView();
    }
    handleClick(e) {
        if (e.defaultPrevented) {
            return false;
        }
        this.handleInvoked();
        return false;
    }
    handleInvoked() {
        this.$emit("pickeroptioninvoked");
    }
    updateView() {
        var _a, _b;
        this.disconnectView();
        this.customView = (_b = (_a = this.contentsTemplate) === null || _a === void 0 ? void 0 : _a.render(this, this)) !== null && _b !== void 0 ? _b : defaultContentsTemplate.render(this, this);
    }
    disconnectView() {
        var _a;
        (_a = this.customView) === null || _a === void 0 ? void 0 : _a.dispose();
        this.customView = undefined;
    }
}
__decorate([
    attr({ attribute: "value" })
], PickerMenuOption.prototype, "value", void 0);
__decorate([
    observable
], PickerMenuOption.prototype, "contentsTemplate", void 0);
