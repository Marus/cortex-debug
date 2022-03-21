import { __awaiter } from "tslib";
import { defaultExecutionContext, ViewTemplate, } from "@microsoft/fast-element";
import { DesignSystem } from "../design-system";
function findElement(view) {
    let current = view.firstChild;
    while (current !== null && current.nodeType !== 1) {
        current = current.nextSibling;
    }
    return current;
}
/**
 * Creates a random, unique name suitable for use as a Custom Element name.
 */
export function uniqueElementName() {
    return `fast-unique-${Math.random().toString(36).substring(7)}`;
}
/* eslint-disable @typescript-eslint/no-unused-vars */
function isElementRegistry(obj) {
    return typeof obj.register === "function";
}
/**
 * Creates a test fixture suitable for testing custom elements, templates, and bindings.
 * @param templateNameOrRegistry An HTML template or single element name to create the fixture for.
 * @param options Enables customizing fixture creation behavior.
 * @remarks
 * Yields control to the caller one Microtask later, in order to
 * ensure that the DOM has settled.
 */
export function fixture(templateNameOrRegistry, options = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        const document = options.document || globalThis.document;
        const parent = options.parent || document.createElement("div");
        const source = options.source || {};
        const context = options.context || defaultExecutionContext;
        if (typeof templateNameOrRegistry === "string") {
            const html = `<${templateNameOrRegistry}></${templateNameOrRegistry}>`;
            templateNameOrRegistry = new ViewTemplate(html, []);
        }
        else if (isElementRegistry(templateNameOrRegistry)) {
            templateNameOrRegistry = [templateNameOrRegistry];
        }
        if (Array.isArray(templateNameOrRegistry)) {
            const first = templateNameOrRegistry[0];
            const ds = options.designSystem || DesignSystem.getOrCreate(parent);
            let prefix = "";
            ds.register(templateNameOrRegistry, {
                register(container, context) {
                    prefix = context.elementPrefix;
                },
            });
            const elementName = `${prefix}-${first.definition.baseName}`;
            const html = `<${elementName}></${elementName}>`;
            templateNameOrRegistry = new ViewTemplate(html, []);
        }
        const view = templateNameOrRegistry.create();
        const element = findElement(view);
        let isConnected = false;
        view.bind(source, context);
        view.appendTo(parent);
        customElements.upgrade(parent);
        // Hook into the Microtask Queue to ensure the DOM is settled
        // before yielding control to the caller.
        yield Promise.resolve();
        const connect = () => __awaiter(this, void 0, void 0, function* () {
            if (isConnected) {
                return;
            }
            isConnected = true;
            document.body.appendChild(parent);
            yield Promise.resolve();
        });
        const disconnect = () => __awaiter(this, void 0, void 0, function* () {
            if (!isConnected) {
                return;
            }
            isConnected = false;
            document.body.removeChild(parent);
            yield Promise.resolve();
        });
        return {
            document,
            template: templateNameOrRegistry,
            view,
            parent,
            element,
            connect,
            disconnect,
        };
    });
}
