import { FASTElementDefinition } from "@microsoft/fast-element";
import { FoundationElement } from "../foundation-element/foundation-element";
import { DI, Registration } from "../di/di";
import { DesignToken } from "../design-token/design-token";
import { ComponentPresentation } from "./component-presentation";
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Indicates what to do with an ambiguous (duplicate) element.
 * @public
 */
export const ElementDisambiguation = Object.freeze({
    /**
     * Skip defining the element but still call the provided callback passed
     * to DesignSystemRegistrationContext.tryDefineElement
     */
    definitionCallbackOnly: null,
    /**
     * Ignore the duplicate element entirely.
     */
    ignoreDuplicate: Symbol(),
});
const elementTypesByTag = new Map();
const elementTagsByType = new Map();
let rootDesignSystem = null;
const designSystemKey = DI.createInterface(x => x.cachedCallback(handler => {
    if (rootDesignSystem === null) {
        rootDesignSystem = new DefaultDesignSystem(null, handler);
    }
    return rootDesignSystem;
}));
/**
 * An API gateway to design system features.
 * @public
 */
export const DesignSystem = Object.freeze({
    /**
     * Returns the HTML element name that the type is defined as.
     * @param type - The type to lookup.
     * @public
     */
    tagFor(type) {
        return elementTagsByType.get(type);
    },
    /**
     * Searches the DOM hierarchy for the design system that is responsible
     * for the provided element.
     * @param element - The element to locate the design system for.
     * @returns The located design system.
     * @public
     */
    responsibleFor(element) {
        const owned = element.$$designSystem$$;
        if (owned) {
            return owned;
        }
        const container = DI.findResponsibleContainer(element);
        return container.get(designSystemKey);
    },
    /**
     * Gets the DesignSystem if one is explicitly defined on the provided element;
     * otherwise creates a design system defined directly on the element.
     * @param element - The element to get or create a design system for.
     * @returns The design system.
     * @public
     */
    getOrCreate(node) {
        if (!node) {
            if (rootDesignSystem === null) {
                rootDesignSystem = DI.getOrCreateDOMContainer().get(designSystemKey);
            }
            return rootDesignSystem;
        }
        const owned = node.$$designSystem$$;
        if (owned) {
            return owned;
        }
        const container = DI.getOrCreateDOMContainer(node);
        if (container.has(designSystemKey, false)) {
            return container.get(designSystemKey);
        }
        else {
            const system = new DefaultDesignSystem(node, container);
            container.register(Registration.instance(designSystemKey, system));
            return system;
        }
    },
});
function extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback) {
    if (typeof params === "string") {
        return {
            name: params,
            type: elementDefinitionType,
            callback: elementDefinitionCallback,
        };
    }
    else {
        return params;
    }
}
class DefaultDesignSystem {
    constructor(owner, container) {
        this.owner = owner;
        this.container = container;
        this.designTokensInitialized = false;
        this.prefix = "fast";
        this.shadowRootMode = undefined;
        this.disambiguate = () => ElementDisambiguation.definitionCallbackOnly;
        if (owner !== null) {
            owner.$$designSystem$$ = this;
        }
    }
    withPrefix(prefix) {
        this.prefix = prefix;
        return this;
    }
    withShadowRootMode(mode) {
        this.shadowRootMode = mode;
        return this;
    }
    withElementDisambiguation(callback) {
        this.disambiguate = callback;
        return this;
    }
    withDesignTokenRoot(root) {
        this.designTokenRoot = root;
        return this;
    }
    register(...registrations) {
        const container = this.container;
        const elementDefinitionEntries = [];
        const disambiguate = this.disambiguate;
        const shadowRootMode = this.shadowRootMode;
        const context = {
            elementPrefix: this.prefix,
            tryDefineElement(params, elementDefinitionType, elementDefinitionCallback) {
                const extractedParams = extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback);
                const { name, callback, baseClass } = extractedParams;
                let { type } = extractedParams;
                let elementName = name;
                let typeFoundByName = elementTypesByTag.get(elementName);
                let needsDefine = true;
                while (typeFoundByName) {
                    const result = disambiguate(elementName, type, typeFoundByName);
                    switch (result) {
                        case ElementDisambiguation.ignoreDuplicate:
                            return;
                        case ElementDisambiguation.definitionCallbackOnly:
                            needsDefine = false;
                            typeFoundByName = void 0;
                            break;
                        default:
                            elementName = result;
                            typeFoundByName = elementTypesByTag.get(elementName);
                            break;
                    }
                }
                if (needsDefine) {
                    if (elementTagsByType.has(type) || type === FoundationElement) {
                        type = class extends type {
                        };
                    }
                    elementTypesByTag.set(elementName, type);
                    elementTagsByType.set(type, elementName);
                    if (baseClass) {
                        elementTagsByType.set(baseClass, elementName);
                    }
                }
                elementDefinitionEntries.push(new ElementDefinitionEntry(container, elementName, type, shadowRootMode, callback, needsDefine));
            },
        };
        if (!this.designTokensInitialized) {
            this.designTokensInitialized = true;
            if (this.designTokenRoot !== null) {
                DesignToken.registerRoot(this.designTokenRoot);
            }
        }
        container.registerWithContext(context, ...registrations);
        for (const entry of elementDefinitionEntries) {
            entry.callback(entry);
            if (entry.willDefine && entry.definition !== null) {
                entry.definition.define();
            }
        }
        return this;
    }
}
class ElementDefinitionEntry {
    constructor(container, name, type, shadowRootMode, callback, willDefine) {
        this.container = container;
        this.name = name;
        this.type = type;
        this.shadowRootMode = shadowRootMode;
        this.callback = callback;
        this.willDefine = willDefine;
        this.definition = null;
    }
    definePresentation(presentation) {
        ComponentPresentation.define(this.name, presentation, this.container);
    }
    defineElement(definition) {
        this.definition = new FASTElementDefinition(this.type, Object.assign(Object.assign({}, definition), { name: this.name }));
    }
    tagFor(type) {
        return DesignSystem.tagFor(type);
    }
}
/* eslint-enable @typescript-eslint/no-non-null-assertion */
