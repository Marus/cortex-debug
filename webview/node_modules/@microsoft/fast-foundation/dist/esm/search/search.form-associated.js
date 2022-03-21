import { FormAssociated } from "../form-associated/form-associated";
import { FoundationElement } from "../foundation-element";
class _Search extends FoundationElement {
}
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Search:class)} component.
 *
 * @internal
 */
export class FormAssociatedSearch extends FormAssociated(_Search) {
    constructor() {
        super(...arguments);
        this.proxy = document.createElement("input");
    }
}
