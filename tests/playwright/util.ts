import { expect, CDPSession, chromium, Page } from "@playwright/test";
import { Options } from "hctx/types";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default {
    preparePage,
    checkMemoryLeaks
}

type HTMLTemplate = string;
type JSTemplate = string;

type JSDto = {
    onLoaded?: string,
    beforeLoaded?: string,
    onStarted?: string
}

type InjectConfig = {
    html: HTMLTemplate
    startOptions?: Options
} & JSDto


type RootElement = HTMLElement & {
    evalScripts: (jsDto: JSDto, startOptions?: Options) => void
}

//useful for html syntax highlighting and intellisense. Requires lit-plugin installed in vscode
export function html(strings: TemplateStringsArray): HTMLTemplate {
    return strings.raw[0]
}

// usefull for js syntax highligthing. Requires vscode-js-template-literal plugin installed in vscode
export function js(strings: TemplateStringsArray): JSTemplate {
    return strings.raw[0]
}
const __dirname = dirname(fileURLToPath(import.meta.url));

async function preparePage(page: Page, inject: InjectConfig) {
    await page.goto(`file://${path.join(__dirname, 'index.html')}`, {
        waitUntil: "domcontentloaded"
    });
    await page.evaluate((i) => {
        let rootEl = document.querySelector("#root") as RootElement;
        rootEl.innerHTML = i.html
        rootEl.evalScripts({ onLoaded: i.onLoaded, beforeLoaded: i.beforeLoaded, onStarted: i.onStarted }, i.startOptions)
    }, inject);

}

// Detects memory leaks by checking if removed DOM elements are garbage collected.
// Uses WeakRef: if deref() returns undefined after GC, the element was properly released.
//
// IMPORTANT: Callers must use page.evaluate() for all DOM interactions (clicks, reads)
// before calling this function. Playwright's page.click() and expect(locator) create
// CDP RemoteObject references that act as GC roots and cause false positives.
async function checkMemoryLeaks(page: Page, elementConfig: { idsToRemove?: string[], idToCheck: string[] }) {
    // Create WeakRefs for elements we want to check before removing them
    await page.evaluate((ids) => {
        const refs: Record<string, WeakRef<Element>> = {};
        for (const id of ids) {
            const el = document.querySelector(`#${id}`);
            if (el) refs[id] = new WeakRef(el);
        }
        (window as any).__leakCheckRefs = refs;
    }, elementConfig.idToCheck);

    if (elementConfig.idsToRemove) {
        await page.evaluate((ec) => {
            if (ec.idsToRemove) for (let idToRemove of ec.idsToRemove) {
                let el = document.querySelector(`#${idToRemove}`);
                el && el.remove()
            }
        }, elementConfig)
    }

    // Wait for MutationObserver callbacks and async cleanups to complete
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

    const cdp = await page.context().newCDPSession(page);

    // Run GC multiple times to ensure cleanup
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');

    // Check which WeakRefs are still alive (leaked)
    const result = await page.evaluate(() => {
        const refs = (window as any).__leakCheckRefs as Record<string, WeakRef<Element>>;
        const leaked: string[] = [];
        const diagnostics: string[] = [];
        for (const [id, ref] of Object.entries(refs)) {
            const el = ref.deref();
            if (el !== undefined) {
                leaked.push(id);
                diagnostics.push(`#${id}: isConnected=${el.isConnected}, parent=${el.parentNode?.nodeName || 'null'}`);
            } else {
                diagnostics.push(`#${id}: collected`);
            }
        }
        delete (window as any).__leakCheckRefs;
        return { leaked, diagnostics };
    });

    for (let id of elementConfig.idToCheck) {
        expect(result.leaked.includes(id), `Memory leak: #${id} retained\n${result.diagnostics.join('\n')}`).toBe(false);
    }
}
