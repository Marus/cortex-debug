import { __decorate } from "tslib";
import { DOM, ElementStyles, FASTElement, observable, Observable, } from "@microsoft/fast-element";
export const defaultElement = document.createElement("div");
function isFastElement(element) {
    return element instanceof FASTElement;
}
class QueuedStyleSheetTarget {
    setProperty(name, value) {
        DOM.queueUpdate(() => this.target.setProperty(name, value));
    }
    removeProperty(name) {
        DOM.queueUpdate(() => this.target.removeProperty(name));
    }
}
/**
 * Handles setting properties for a FASTElement using Constructable Stylesheets
 */
class ConstructableStyleSheetTarget extends QueuedStyleSheetTarget {
    constructor(source) {
        super();
        const sheet = new CSSStyleSheet();
        this.target = sheet.cssRules[sheet.insertRule(":host{}")].style;
        source.$fastController.addStyles(ElementStyles.create([sheet]));
    }
}
class DocumentStyleSheetTarget extends QueuedStyleSheetTarget {
    constructor() {
        super();
        const sheet = new CSSStyleSheet();
        this.target = sheet.cssRules[sheet.insertRule(":root{}")].style;
        document.adoptedStyleSheets = [
            ...document.adoptedStyleSheets,
            sheet,
        ];
    }
}
class HeadStyleElementStyleSheetTarget extends QueuedStyleSheetTarget {
    constructor() {
        super();
        this.style = document.createElement("style");
        document.head.appendChild(this.style);
        const { sheet } = this.style;
        // Because the HTMLStyleElement has been appended,
        // there shouldn't exist a case where `sheet` is null,
        // but if-check it just in case.
        if (sheet) {
            // https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
            // which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
            const index = sheet.insertRule(":root{}", sheet.cssRules.length);
            this.target = sheet.cssRules[index].style;
        }
    }
}
/**
 * Handles setting properties for a FASTElement using an HTMLStyleElement
 */
class StyleElementStyleSheetTarget {
    constructor(target) {
        this.store = new Map();
        this.target = null;
        const controller = target.$fastController;
        this.style = document.createElement("style");
        controller.addStyles(this.style);
        Observable.getNotifier(controller).subscribe(this, "isConnected");
        this.handleChange(controller, "isConnected");
    }
    targetChanged() {
        if (this.target !== null) {
            for (const [key, value] of this.store.entries()) {
                this.target.setProperty(key, value);
            }
        }
    }
    setProperty(name, value) {
        this.store.set(name, value);
        DOM.queueUpdate(() => {
            if (this.target !== null) {
                this.target.setProperty(name, value);
            }
        });
    }
    removeProperty(name) {
        this.store.delete(name);
        DOM.queueUpdate(() => {
            if (this.target !== null) {
                this.target.removeProperty(name);
            }
        });
    }
    handleChange(source, key) {
        // HTMLStyleElement.sheet is null if the element isn't connected to the DOM,
        // so this method reacts to changes in DOM connection for the element hosting
        // the HTMLStyleElement.
        //
        // All rules applied via the CSSOM also get cleared when the element disconnects,
        // so we need to add a new rule each time and populate it with the stored properties
        const { sheet } = this.style;
        if (sheet) {
            // Safari will throw if we try to use the return result of insertRule()
            // to index the rule inline, so store as a const prior to indexing.
            // https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
            // which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
            const index = sheet.insertRule(":host{}", sheet.cssRules.length);
            this.target = sheet.cssRules[index].style;
        }
        else {
            this.target = null;
        }
    }
}
__decorate([
    observable
], StyleElementStyleSheetTarget.prototype, "target", void 0);
/**
 * Handles setting properties for a normal HTMLElement
 */
class ElementStyleSheetTarget {
    constructor(source) {
        this.target = source.style;
    }
    setProperty(name, value) {
        DOM.queueUpdate(() => this.target.setProperty(name, value));
    }
    removeProperty(name) {
        DOM.queueUpdate(() => this.target.removeProperty(name));
    }
}
/**
 * Controls emission for default values. This control is capable
 * of emitting to multiple {@link PropertyTarget | PropertyTargets},
 * and only emits if it has at least one root.
 *
 * @internal
 */
export class RootStyleSheetTarget {
    setProperty(name, value) {
        RootStyleSheetTarget.properties[name] = value;
        for (const target of RootStyleSheetTarget.roots.values()) {
            PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).setProperty(name, value);
        }
    }
    removeProperty(name) {
        delete RootStyleSheetTarget.properties[name];
        for (const target of RootStyleSheetTarget.roots.values()) {
            PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).removeProperty(name);
        }
    }
    static registerRoot(root) {
        const { roots } = RootStyleSheetTarget;
        if (!roots.has(root)) {
            roots.add(root);
            const target = PropertyTargetManager.getOrCreate(this.normalizeRoot(root));
            for (const key in RootStyleSheetTarget.properties) {
                target.setProperty(key, RootStyleSheetTarget.properties[key]);
            }
        }
    }
    static unregisterRoot(root) {
        const { roots } = RootStyleSheetTarget;
        if (roots.has(root)) {
            roots.delete(root);
            const target = PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(root));
            for (const key in RootStyleSheetTarget.properties) {
                target.removeProperty(key);
            }
        }
    }
    /**
     * Returns the document when provided the default element,
     * otherwise is a no-op
     * @param root - the root to normalize
     */
    static normalizeRoot(root) {
        return root === defaultElement ? document : root;
    }
}
RootStyleSheetTarget.roots = new Set();
RootStyleSheetTarget.properties = {};
// Caches PropertyTarget instances
const propertyTargetCache = new WeakMap();
// Use Constructable StyleSheets for FAST elements when supported, otherwise use
// HTMLStyleElement instances
const propertyTargetCtor = DOM.supportsAdoptedStyleSheets
    ? ConstructableStyleSheetTarget
    : StyleElementStyleSheetTarget;
/**
 * Manages creation and caching of PropertyTarget instances.
 *
 * @internal
 */
export const PropertyTargetManager = Object.freeze({
    getOrCreate(source) {
        if (propertyTargetCache.has(source)) {
            /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
            return propertyTargetCache.get(source);
        }
        let target;
        if (source === defaultElement) {
            target = new RootStyleSheetTarget();
        }
        else if (source instanceof Document) {
            target = DOM.supportsAdoptedStyleSheets
                ? new DocumentStyleSheetTarget()
                : new HeadStyleElementStyleSheetTarget();
        }
        else if (isFastElement(source)) {
            target = new propertyTargetCtor(source);
        }
        else {
            target = new ElementStyleSheetTarget(source);
        }
        propertyTargetCache.set(source, target);
        return target;
    },
});
