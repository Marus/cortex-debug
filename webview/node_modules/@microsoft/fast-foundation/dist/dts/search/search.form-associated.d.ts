import { FormAssociated } from "../form-associated/form-associated";
import { FoundationElement } from "../foundation-element";
declare class _Search extends FoundationElement {
}
interface _Search extends FormAssociated {
}
declare const FormAssociatedSearch_base: typeof _Search;
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Search:class)} component.
 *
 * @internal
 */
export declare class FormAssociatedSearch extends FormAssociatedSearch_base {
    proxy: HTMLInputElement;
}
export {};
