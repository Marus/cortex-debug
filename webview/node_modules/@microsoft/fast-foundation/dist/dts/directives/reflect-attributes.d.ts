import type { CaptureType } from "@microsoft/fast-element";
/**
 * Reflects attributes from the host element to the target element of the directive.
 * @param attributes - The attributes to reflect
 *
 * @beta
 * @example
 * ```ts
 * const template = html`
 *     <button
 *         ${reflectAttributes("aria-label", "aria-describedby")}
 *     >
 *          hello world
 *     </button
 * `
 * ```
 */
export declare function reflectAttributes<T = any>(...attributes: string[]): CaptureType<T>;
