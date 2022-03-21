import { FormAssociated } from "../form-associated/form-associated";
import { FoundationElement } from "../foundation-element";
declare class _Picker extends FoundationElement {
}
interface _Picker extends FormAssociated {
}
declare const FormAssociatedPicker_base: typeof _Picker;
/**
 * A form-associated base class for the {@link @microsoft/fast-foundation#(Picker:class)} component.
 *
 * @internal
 */
export declare class FormAssociatedPicker extends FormAssociatedPicker_base {
    proxy: HTMLInputElement;
}
export {};
