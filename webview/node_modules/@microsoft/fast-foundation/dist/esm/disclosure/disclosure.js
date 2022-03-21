import { __decorate } from "tslib";
import { attr } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element";
/**
 * A Disclosure Custom HTML Element.
 * Based largely on the {@link https://w3c.github.io/aria-practices/#disclosure | disclosure element }.
 *
 * @public
 */
export class Disclosure extends FoundationElement {
    /**
     * @internal
     */
    connectedCallback() {
        super.connectedCallback();
        this.setup();
    }
    /**
     * @internal
     */
    disconnectedCallback() {
        super.disconnectedCallback();
        this.details.removeEventListener("toggle", this.onToggle);
    }
    /**
     * Show extra content.
     */
    show() {
        this.details.open = true;
    }
    /**
     * Hide extra content.
     */
    hide() {
        this.details.open = false;
    }
    /**
     * Toggle the current(expanded/collapsed) state.
     */
    toggle() {
        this.details.open = !this.details.open;
    }
    /**
     * Register listener and set default disclosure mode
     */
    setup() {
        this.onToggle = this.onToggle.bind(this);
        this.details.addEventListener("toggle", this.onToggle);
        if (this.expanded) {
            this.show();
        }
    }
    /**
     * Update the aria attr and fire `toggle` event
     */
    onToggle() {
        this.expanded = this.details.open;
        this.$emit("toggle");
    }
}
__decorate([
    attr({ mode: "boolean" })
], Disclosure.prototype, "expanded", void 0);
__decorate([
    attr
], Disclosure.prototype, "title", void 0);
