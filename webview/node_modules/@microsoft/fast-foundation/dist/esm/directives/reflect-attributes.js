import { AttachedBehaviorHTMLDirective, SubscriberSet, DOM, } from "@microsoft/fast-element";
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        AttributeReflectionSubscriptionSet.getOrCreateFor(mutation.target).notify(mutation.attributeName);
    }
});
class AttributeReflectionSubscriptionSet extends SubscriberSet {
    constructor(source) {
        super(source);
        this.watchedAttributes = new Set();
        AttributeReflectionSubscriptionSet.subscriberCache.set(source, this);
    }
    subscribe(subscriber) {
        super.subscribe(subscriber);
        if (!this.watchedAttributes.has(subscriber.attributes)) {
            this.watchedAttributes.add(subscriber.attributes);
            this.observe();
        }
    }
    unsubscribe(subscriber) {
        super.unsubscribe(subscriber);
        if (this.watchedAttributes.has(subscriber.attributes)) {
            this.watchedAttributes.delete(subscriber.attributes);
            this.observe();
        }
    }
    static getOrCreateFor(source) {
        return (this.subscriberCache.get(source) ||
            new AttributeReflectionSubscriptionSet(source));
    }
    observe() {
        const attributeFilter = [];
        for (const attributes of this.watchedAttributes.values()) {
            for (let i = 0; i < attributes.length; i++) {
                attributeFilter.push(attributes[i]);
            }
        }
        observer.observe(this.source, { attributeFilter });
    }
}
AttributeReflectionSubscriptionSet.subscriberCache = new WeakMap();
class ReflectAttrBehavior {
    constructor(target, attributes) {
        this.target = target;
        this.attributes = Object.freeze(attributes);
    }
    bind(source) {
        AttributeReflectionSubscriptionSet.getOrCreateFor(source).subscribe(this);
        // Reflect any existing attributes because MutationObserver will only
        // handle *changes* to attributes.
        if (source.hasAttributes()) {
            for (let i = 0; i < source.attributes.length; i++) {
                this.handleChange(source, source.attributes[i].name);
            }
        }
    }
    unbind(source) {
        AttributeReflectionSubscriptionSet.getOrCreateFor(source).unsubscribe(this);
    }
    handleChange(source, arg) {
        // In cases where two or more ReflectAttrBehavior instances are bound to the same element,
        // they will share a Subscriber implementation. In that case, this handle change can be invoked with
        // attributes an instances doesn't need to reflect. This guards against reflecting attrs
        // that shouldn't be reflected.
        if (this.attributes.includes(arg)) {
            DOM.setAttribute(this.target, arg, source.getAttribute(arg));
        }
    }
}
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
export function reflectAttributes(...attributes) {
    return new AttachedBehaviorHTMLDirective("fast-reflect-attr", ReflectAttrBehavior, attributes);
}
