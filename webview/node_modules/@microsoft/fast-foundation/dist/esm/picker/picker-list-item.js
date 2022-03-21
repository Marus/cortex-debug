import { __decorate } from "tslib";
import { attr, html, observable } from "@microsoft/fast-element";
import { keyEnter } from "@microsoft/fast-web-utilities";
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
export class PickerListItem extends FoundationElement {
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
        this.disconnectView();
        super.disconnectedCallback();
    }
    handleKeyDown(e) {
        if (e.defaultPrevented) {
            return false;
        }
        if (e.key === keyEnter) {
            this.handleInvoke();
            return false;
        }
        return true;
    }
    handleClick(e) {
        if (!e.defaultPrevented) {
            this.handleInvoke();
        }
        return false;
    }
    handleInvoke() {
        this.$emit("pickeriteminvoked");
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
], PickerListItem.prototype, "value", void 0);
__decorate([
    observable
], PickerListItem.prototype, "contentsTemplate", void 0);
