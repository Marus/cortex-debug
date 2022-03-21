import { CheckableFormAssociated } from "../form-associated/form-associated";
import { FoundationElement } from "../foundation-element";
class _Radio extends FoundationElement {
}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Radio:class)} component.
 *
 * @internal
 */
export class FormAssociatedRadio extends CheckableFormAssociated(_Radio) {
    constructor() {
        super(...arguments);
        this.proxy = document.createElement("input");
    }
}
