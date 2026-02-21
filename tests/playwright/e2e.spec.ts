import { test, expect, chromium } from '@playwright/test';
import util, { html, js } from './util';

// NOTE: Tests that include memory leak checks (tests 2-5) use page.evaluate()
// for DOM interactions (clicks, assertions) instead of Playwright's page.click()
// or expect(locator). This is because Playwright's high-level APIs create internal
// CDP RemoteObject references to DOM elements, which act as GC roots and prevent
// WeakRef-based leak detection from working correctly.

test('is starting', async ({ page }) => {
  await util.preparePage(page, {
    html: html`
        <h1>Checking hctx ...</h1>
        <blockquote id="loaded"></blockquote>
        <blockquote id="started"></blockquote>
      `,
    onLoaded: js`
        let el = document.querySelector("#loaded");
        console.log("loaded")
        el.setAttribute("hctx-loaded", true);
      `,
    onStarted: js`
        let el = document.querySelector("#started");
        console.log("started")
        el.setAttribute("hctx-started", true);
      `
  })

  await expect(page.locator('#loaded')).toHaveAttribute('hctx-loaded');
  await expect(page.locator('#started')).toHaveAttribute('hctx-started');
});

test('single context with basic action and effect', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();


  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="increment count on a:count"></h3>
          <button id="action-el" hc-action="count on click">count</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: {
            count: 0,
          },
          actions: {
            count: {
              handle: ({ data, el }) => {
                if (!data.count) {
                  data.count = 1;
                } else {
                  data.count++;
                }
              },
            }
          },
          effects: {
            "increment count": {
              handle: ({ data, el }) => {
                el.textContent = data.count;
              },
            }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '1') throw new Error('effect did not run');
  })
  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'action-el', 'effect-el']
  })
})

test('single context with basic action and effect with subscription', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();
  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="increment count1 on hc:statechanged"></h3>
          <h3 id="effect-el-2" hc-effect="increment count2 on hc:statechanged"></h3>
          <button id="action-el" hc-action="count on click">count</button>
        </div>
        <div id="non-ctx-effect" hc-effect="increment count1 on hc:statechanged"></div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: {
            counter: {
              count: 0
            },
          },
          actions: {
            count: {
              handle: ({ data, el }) => {
                if (!data.counter.count) {
                  data.counter.count = 1;
                } else {
                  data.counter.count++;
                }
              },
            }
          },
          effects: {
            "increment count1": {
              handle: ({ data, el }) => {
                el.textContent = data.counter.count;
              },
              subscribe: ({add, data}) =>{
                add(data.counter, "count");
              }
            },
            "increment count2": {
              handle: ({ data, el }) => {
                el.textContent = data.counter.count;
              },
              subscribe: ({add, data}) =>{
                add(data.counter);
              }
            }
          }
        }));
      `
  })
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  }
  // Subscription effects (hc:statechanged) update DOM asynchronously via proxy set trap
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '3') throw new Error('effect-el count wrong');
    if (document.querySelector('#effect-el-2')?.textContent !== '3') throw new Error('effect-el-2 count wrong');
    if (document.querySelector('#non-ctx-effect')?.textContent !== '') throw new Error('non-ctx-effect should be empty');
  })
  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'action-el', 'effect-el', 'effect-el-2']
  })
})

test('multicontext isolation', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();
  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="increment on hc:statechanged"></h3>
          <button id="action-el" hc-action="count on click">count</button>
        </div>
        <div id="non-ctx-effect" hc-effect="increment count1 on hc:statechanged"></div>
        <div id="ctx2-el" hctx="context2">
          <h3 id="effect-el-ctx2" hc-effect="increment on hc:statechanged"></h3>
          <button id="action-el-ctx2" hc-action="count on click">count</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: {
            counter: {
              count: 0
            },
          },
          actions: {
            count: {
              handle: ({ data, el }) => {
                if (!data.counter.count) {
                  data.counter.count = 1;
                } else {
                  data.counter.count++;
                }
              },
            }
          },
          effects: {
            "increment": {
              handle: ({ data, el }) => {
                el.textContent = data.counter.count;
              },
              subscribe: ({add, data}) =>{
                add(data.counter, "count");
              }
            },
          }
        }));
        hctx.newCtx("context2", () => ({
          data: {
            counter: {
              count: 0
            },
          },
          actions: {
            count: {
              handle: ({ data, el }) => {
                if (!data.counter.count) {
                  data.counter.count = 1;
                } else {
                  data.counter.count++;
                }
              },
            }
          },
          effects: {
            "increment": {
              handle: ({ data, el }) => {
                el.textContent = data.counter.count;
              },
              subscribe: ({add, data}) =>{
                add(data.counter, "count");
                add(data, "counter");
              }
            },
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (document.querySelector('#action-el-ctx2') as HTMLElement).click())
  }
  // Subscription effects (hc:statechanged) update DOM asynchronously via proxy set trap
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '1') throw new Error('effect-el count wrong');
    if (document.querySelector('#effect-el-ctx2')?.textContent !== '2') throw new Error('effect-el-ctx2 count wrong');
    if (document.querySelector('#non-ctx-effect')?.textContent !== '') throw new Error('non-ctx-effect should be empty');
  })
  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx2-el', 'ctx-el'],
    idToCheck: ['ctx-el', 'action-el', 'effect-el', 'effect-el-2', 'ctx2-el', 'action-el-ctx2', 'effect-el-ctx2']
  })
})

test('memory leak detection catches retained detached elements', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="increment count on a:count"></h3>
          <button id="action-el" hc-action="count on click">count</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            count: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            "increment count": {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Intentionally leak: store reference on window before removing
  await page.evaluate(() => {
    (window as any)._leaked = document.querySelector('#ctx-el');
  });

  // checkMemoryLeaks should detect the retained detached element
  let caught = false;
  try {
    await util.checkMemoryLeaks(page, {
      idsToRemove: ['ctx-el'],
      idToCheck: ['ctx-el']
    })
  } catch (e) {
    caught = true;
  }
  expect(caught, 'Memory leak detection should catch retained detached element').toBe(true);
})

test('tags create independent context instances', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-first" hctx="counter#first">
          <h3 id="effect-first" hc-effect="render on a:increment"></h3>
          <button id="action-first" hc-action="increment on click">+1</button>
        </div>
        <div id="ctx-second" hctx="counter#second">
          <h3 id="effect-second" hc-effect="render on a:increment"></h3>
          <button id="action-second" hc-action="increment on click">+1</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("counter", () => ({
          data: { count: 0 },
          actions: {
            increment: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Click first counter 3 times
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (document.querySelector('#action-first') as HTMLElement).click())
  }
  // Click second counter 1 time
  await page.evaluate(() => (document.querySelector('#action-second') as HTMLElement).click())

  await page.evaluate(() => {
    if (document.querySelector('#effect-first')?.textContent !== '3') throw new Error('first counter should be 3');
    if (document.querySelector('#effect-second')?.textContent !== '1') throw new Error('second counter should be 1');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-first', 'ctx-second'],
    idToCheck: ['ctx-first', 'action-first', 'effect-first', 'ctx-second', 'action-second', 'effect-second']
  })
})

test('local actions are scoped to their fragment', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-frag1" hctx="panel">
          <h3 id="effect-frag1" hc-effect="render on a:toggle"></h3>
          <button id="action-frag1" hc-action="$toggle on click">toggle</button>
        </div>
        <div id="ctx-frag2" hctx="panel">
          <h3 id="effect-frag2" hc-effect="render on a:toggle"></h3>
          <button id="action-frag2" hc-action="$toggle on click">toggle</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("panel", () => ({
          data: { count: 0 },
          actions: {
            toggle: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Click fragment 1 — only fragment 1's effect should fire
  await page.evaluate(() => (document.querySelector('#action-frag1') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-frag1')?.textContent !== '1') throw new Error('frag1 effect should show 1');
    if (document.querySelector('#effect-frag2')?.textContent !== '') throw new Error('frag2 effect should not have fired');
  })

  // Click fragment 2 — only fragment 2's effect fires (data.count is now 2 since data is shared)
  await page.evaluate(() => (document.querySelector('#action-frag2') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-frag1')?.textContent !== '1') throw new Error('frag1 effect should still show 1');
    if (document.querySelector('#effect-frag2')?.textContent !== '2') throw new Error('frag2 effect should show 2');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-frag1', 'ctx-frag2'],
    idToCheck: ['ctx-frag1', 'action-frag1', 'effect-frag1', 'ctx-frag2', 'action-frag2', 'effect-frag2']
  })
})

test('fragments share data and action triggers across DOM locations', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <nav>
          <div id="ctx-header" hctx="cart">
            <span id="effect-header" hc-effect="renderCount on a:addItem"></span>
          </div>
        </nav>
        <main>
          <div id="ctx-main" hctx="cart">
            <span id="effect-main" hc-effect="renderCount on a:addItem"></span>
            <button id="action-add" hc-action="addItem on click">Add</button>
          </div>
        </main>
      `,
    onLoaded: js`
        hctx.newCtx("cart", () => ({
          data: { count: 0 },
          actions: {
            addItem: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            renderCount: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Click add in main fragment — both header and main effects should update
  await page.evaluate(() => (document.querySelector('#action-add') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-header')?.textContent !== '1') throw new Error('header effect should show 1');
    if (document.querySelector('#effect-main')?.textContent !== '1') throw new Error('main effect should show 1');
  })

  // Click again
  await page.evaluate(() => (document.querySelector('#action-add') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-header')?.textContent !== '2') throw new Error('header effect should show 2');
    if (document.querySelector('#effect-main')?.textContent !== '2') throw new Error('main effect should show 2');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-header', 'ctx-main'],
    idToCheck: ['ctx-header', 'effect-header', 'ctx-main', 'effect-main', 'action-add']
  })
})

test('write traps prevent mutation in effects and allowStateMutations bypasses it', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="trapped-effect" hc-effect="trapped on a:testTrap"></h3>
          <h3 id="allowed-effect" hc-effect="allowed on a:testAllow"></h3>
          <button id="action-trap" hc-action="testTrap on click">trap</button>
          <button id="action-allow" hc-action="testAllow on click">allow</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            testTrap: {
              handle: ({ data }) => { data.count++; }
            },
            testAllow: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            trapped: {
              handle: ({ data, el }) => {
                el.textContent = 'before';
                data.count = 999;
                el.textContent = 'after';
              }
            },
            allowed: {
              handle: ({ data, el }) => {
                data.count += 10;
                el.textContent = data.count;
              },
              allowStateMutations: true
            }
          }
        }));
      `
  })

  // Test 1: trapped effect — write should throw, stopping at 'before'
  await page.evaluate(() => (document.querySelector('#action-trap') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#trapped-effect')?.textContent !== 'before')
      throw new Error('trapped effect should stop at before, got: ' + document.querySelector('#trapped-effect')?.textContent);
  })
  expect(pageErrors.length, 'write trap should have thrown').toBeGreaterThan(0);
  expect(pageErrors[0]).toContain('writes not allowed within effects');

  // Test 2: allowed effect — allowStateMutations lets the write succeed
  await page.evaluate(() => (document.querySelector('#action-allow') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#allowed-effect')?.textContent !== '12')
      throw new Error('allowed effect should show 12, got: ' + document.querySelector('#allowed-effect')?.textContent);
  })
})

test('action phases fire effects in before/after order', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-before" hc-effect="logBefore on a:save:before"></h3>
          <h3 id="effect-after" hc-effect="logAfter on a:save:after"></h3>
          <h3 id="effect-default" hc-effect="logDefault on a:save"></h3>
          <button id="action-el" hc-action="save on click">save</button>
        </div>
      `,
    onLoaded: js`
        window.__phaseLog = [];
        hctx.newCtx("context", () => ({
          data: { saved: false },
          actions: {
            save: {
              handle: ({ data }) => {
                window.__phaseLog.push('action');
                data.saved = true;
              }
            }
          },
          effects: {
            logBefore: {
              handle: ({ el }) => {
                window.__phaseLog.push('before');
                el.textContent = 'before';
              }
            },
            logAfter: {
              handle: ({ el }) => {
                window.__phaseLog.push('after');
                el.textContent = 'after';
              }
            },
            logDefault: {
              handle: ({ el }) => {
                window.__phaseLog.push('default');
                el.textContent = 'default';
              }
            }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())

  // Verify all effects fired
  await page.evaluate(() => {
    if (document.querySelector('#effect-before')?.textContent !== 'before') throw new Error('before effect should fire');
    if (document.querySelector('#effect-after')?.textContent !== 'after') throw new Error('after effect should fire');
    if (document.querySelector('#effect-default')?.textContent !== 'default') throw new Error('default effect should fire');
  })

  // Verify ordering: before → action → after (default = after)
  const log = await page.evaluate(() => (window as any).__phaseLog as string[]);
  expect(log).toEqual(['before', 'action', 'after', 'default']);

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-before', 'effect-after', 'effect-default', 'action-el']
  })
})

test('context composition with @ triggers across contexts', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-form" hctx="formCtx">
          <button id="action-submit" hc-action="submit on click">Submit</button>
          <h3 id="effect-form" hc-effect="renderForm on a:submit"></h3>
        </div>
        <div id="ctx-notif" hctx="notifCtx">
          <h3 id="effect-notif" hc-effect="showSuccess on a:submit@formCtx"></h3>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("formCtx", () => ({
          data: { submitted: false },
          actions: {
            submit: {
              handle: ({ data }) => { data.submitted = true; }
            }
          },
          effects: {
            renderForm: {
              handle: ({ data, el }) => { el.textContent = 'submitted'; }
            }
          }
        }));
        hctx.newCtx("notifCtx", () => ({
          data: { message: '' },
          actions: {},
          effects: {
            showSuccess: {
              handle: ({ el }) => { el.textContent = 'notified'; }
            }
          }
        }));
      `
  })

  // Click submit in formCtx — both formCtx and notifCtx effects should fire
  await page.evaluate(() => (document.querySelector('#action-submit') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-form')?.textContent !== 'submitted')
      throw new Error('formCtx effect should show submitted');
    if (document.querySelector('#effect-notif')?.textContent !== 'notified')
      throw new Error('notifCtx effect should show notified via @ trigger');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-form', 'ctx-notif'],
    idToCheck: ['ctx-form', 'action-submit', 'effect-form', 'ctx-notif', 'effect-notif']
  })
})

test('nested contexts are isolated from each other', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-outer" hctx="outer">
          <h3 id="effect-outer" hc-effect="render on a:inc"></h3>
          <button id="action-outer" hc-action="inc on click">outer+</button>
          <div id="ctx-inner" hctx="inner">
            <h3 id="effect-inner" hc-effect="render on a:inc"></h3>
            <button id="action-inner" hc-action="inc on click">inner+</button>
          </div>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("outer", () => ({
          data: { count: 0 },
          actions: {
            inc: { handle: ({ data }) => { data.count++; } }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = 'outer:' + data.count; } }
          }
        }));
        hctx.newCtx("inner", () => ({
          data: { count: 0 },
          actions: {
            inc: { handle: ({ data }) => { data.count++; } }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = 'inner:' + data.count; } }
          }
        }));
      `
  })

  // Click outer — only outer effect fires
  await page.evaluate(() => (document.querySelector('#action-outer') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-outer')?.textContent !== 'outer:1')
      throw new Error('outer effect should show outer:1, got: ' + document.querySelector('#effect-outer')?.textContent);
    if (document.querySelector('#effect-inner')?.textContent !== '')
      throw new Error('inner effect should not fire');
  })

  // Click inner twice — only inner effect fires
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (document.querySelector('#action-inner') as HTMLElement).click())
  }
  await page.evaluate(() => {
    if (document.querySelector('#effect-outer')?.textContent !== 'outer:1')
      throw new Error('outer effect should still show outer:1');
    if (document.querySelector('#effect-inner')?.textContent !== 'inner:2')
      throw new Error('inner effect should show inner:2');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-outer'],
    idToCheck: ['ctx-outer', 'action-outer', 'effect-outer', 'ctx-inner', 'action-inner', 'effect-inner']
  })
})

test('async actions complete before after-phase and prevent concurrent execution', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-before" hc-effect="logBefore on a:fetch:before"></h3>
          <h3 id="effect-after" hc-effect="logAfter on a:fetch"></h3>
          <h3 id="effect-count" hc-effect="renderCount on a:fetch"></h3>
          <button id="action-el" hc-action="fetch on click">fetch</button>
        </div>
      `,
    onLoaded: js`
        window.__asyncLog = [];
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            fetch: {
              handle: async ({ data }) => {
                window.__asyncLog.push('action-start');
                await new Promise(r => setTimeout(r, 100));
                data.count++;
                window.__asyncLog.push('action-end');
              }
            }
          },
          effects: {
            logBefore: {
              handle: ({ el }) => {
                window.__asyncLog.push('before');
                el.textContent = 'before';
              }
            },
            logAfter: {
              handle: ({ el }) => {
                window.__asyncLog.push('after');
                el.textContent = 'after';
              }
            },
            renderCount: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Click 3 times rapidly — only the first should execute (concurrent prevention)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  }

  // Wait for async action to complete
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)))

  // Verify phase ordering: before → action-start → action-end → after
  const log = await page.evaluate(() => (window as any).__asyncLog as string[]);
  expect(log).toEqual(['before', 'action-start', 'action-end', 'after']);

  // Verify count is 1 — concurrent clicks were skipped
  await page.evaluate(() => {
    if (document.querySelector('#effect-count')?.textContent !== '1')
      throw new Error('count should be 1, got: ' + document.querySelector('#effect-count')?.textContent);
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-before', 'effect-after', 'effect-count', 'action-el']
  })
})

test('middleware blocks action execution when returning false', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-guarded" hc-effect="render on a:guarded"></h3>
          <h3 id="effect-open" hc-effect="render on a:open"></h3>
          <button id="action-guarded" hc-action="guarded on click">guarded</button>
          <button id="action-open" hc-action="open on click">open</button>
        </div>
      `,
    onLoaded: js`
        window.__midLog = [];
        const blockMiddleware = ({ type, details }) => {
          window.__midLog.push('mid:' + type);
          return false;
        };
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            guarded: {
              handle: ({ data }) => { data.count++; },
              middleware: [blockMiddleware]
            },
            open: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  // Click guarded — middleware blocks, count stays 0, effect doesn't fire
  await page.evaluate(() => (document.querySelector('#action-guarded') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-guarded')?.textContent !== '')
      throw new Error('guarded effect should not fire');
  })
  const midLog = await page.evaluate(() => (window as any).__midLog as string[]);
  expect(midLog).toEqual(['mid:action']);

  // Click open — no middleware, count increments, effect fires
  await page.evaluate(() => (document.querySelector('#action-open') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-open')?.textContent !== '1')
      throw new Error('open effect should show 1');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-guarded', 'effect-open', 'action-guarded', 'action-open']
  })
})

test('stores share global state across contexts with subscriptions', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-writer" hctx="writer">
          <button id="action-set" hc-action="setTheme on click">dark</button>
        </div>
        <div id="ctx-reader" hctx="reader">
          <h3 id="effect-theme" hc-effect="applyTheme on hc:statechanged"></h3>
        </div>
      `,
    onLoaded: js`
        const themeStore = hctx.newStore(() => ({ theme: 'light' }));
        hctx.newCtx("writer", () => ({
          data: {},
          actions: {
            setTheme: {
              handle: ({ useStore }) => {
                const store = useStore(themeStore);
                store.theme = 'dark';
              }
            }
          },
          effects: {}
        }));
        hctx.newCtx("reader", () => ({
          data: {},
          actions: {},
          effects: {
            applyTheme: {
              handle: ({ el, useStore }) => {
                const store = useStore(themeStore);
                el.textContent = store.theme;
              },
              subscribe: ({ add, useStore }) => {
                const store = useStore(themeStore);
                add(store, "theme");
              }
            }
          }
        }));
      `
  })

  // Click setTheme in writer — reader's subscribed effect should update
  await page.evaluate(() => (document.querySelector('#action-set') as HTMLElement).click())
  // Subscription effects update asynchronously via proxy set trap
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))
  await page.evaluate(() => {
    if (document.querySelector('#effect-theme')?.textContent !== 'dark')
      throw new Error('theme effect should show dark, got: ' + document.querySelector('#effect-theme')?.textContent);
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-writer', 'ctx-reader'],
    idToCheck: ['ctx-writer', 'action-set', 'ctx-reader', 'effect-theme']
  })
})

test('hc:mutated fires for dynamically added elements', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-static" hc-effect="render on hc:loaded"></h3>
          <button id="action-add" hc-action="addElement on click">add</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            addElement: {
              handle: ({ data }) => {
                data.count++;
                const el = document.createElement('h3');
                el.id = 'effect-dynamic';
                el.setAttribute('hc-effect', 'render on hc:mutated');
                document.querySelector('#ctx-el').appendChild(el);
              },
              useRawElement: true
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = 'count:' + data.count; }
            }
          }
        }));
      `
  })

  // Static effect should have fired on hc:loaded
  await page.evaluate(() => {
    if (document.querySelector('#effect-static')?.textContent !== 'count:0')
      throw new Error('static effect should show count:0 on load');
  })

  // Add dynamic element via action
  await page.evaluate(() => (document.querySelector('#action-add') as HTMLElement).click())
  // Wait for MutationObserver to process the new element
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))

  await page.evaluate(() => {
    if (!document.querySelector('#effect-dynamic'))
      throw new Error('dynamic element should exist');
    if (document.querySelector('#effect-dynamic')?.textContent !== 'count:1')
      throw new Error('dynamic effect should show count:1 via hc:mutated, got: ' + document.querySelector('#effect-dynamic')?.textContent);
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-static', 'action-add', 'effect-dynamic']
  })
})

test('props pass JSON data to action handlers', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="render on a:count"></h3>
          <button id="action-5" hc-action="count:{&quot;step&quot;:5} on click">+5</button>
          <button id="action-1" hc-action="count on click">+1</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: { total: 0 },
          actions: {
            count: {
              handle: ({ data }, props) => {
                data.total += props.step ?? 1;
              }
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = data.total; }
            }
          }
        }));
      `
  })

  // Click +5 button (with props)
  await page.evaluate(() => (document.querySelector('#action-5') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '5')
      throw new Error('should be 5, got: ' + document.querySelector('#effect-el')?.textContent);
  })

  // Click +1 button (no props, defaults to step=1)
  await page.evaluate(() => (document.querySelector('#action-1') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '6')
      throw new Error('should be 6, got: ' + document.querySelector('#effect-el')?.textContent);
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-5', 'action-1']
  })
})

test('onCleanup callbacks run when element is removed from DOM', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="startTimer on hc:loaded"></h3>
          <button id="action-remove" hc-action="removeEffect on click">remove</button>
        </div>
      `,
    onLoaded: js`
        window.__ticks = 0;
        window.__cleanupRan = false;
        hctx.newCtx("context", () => ({
          data: {},
          actions: {
            removeEffect: {
              handle: () => {
                document.querySelector('#effect-el')?.remove();
              },
              useRawElement: true
            }
          },
          effects: {
            startTimer: {
              handle: ({ onCleanup }) => {
                const id = setInterval(() => { window.__ticks++; }, 20);
                onCleanup(async () => {
                  clearInterval(id);
                  window.__cleanupRan = true;
                });
              }
            }
          }
        }));
      `
  })

  // Wait for timer to tick a few times
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  const ticksBefore = await page.evaluate(() => (window as any).__ticks as number);
  expect(ticksBefore).toBeGreaterThan(0);

  // Remove the effect element — should trigger onCleanup
  await page.evaluate(() => (document.querySelector('#action-remove') as HTMLElement).click())
  // Wait for MutationObserver to fire cleanup
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)))

  const cleanupRan = await page.evaluate(() => (window as any).__cleanupRan);
  expect(cleanupRan, 'onCleanup should have run').toBe(true);

  // Verify timer stopped — ticks should not increase significantly
  const ticksAfterCleanup = await page.evaluate(() => (window as any).__ticks as number);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  const ticksLater = await page.evaluate(() => (window as any).__ticks as number);
  expect(ticksLater, 'timer should have stopped').toBe(ticksAfterCleanup);
})

test('execute re-triggers action with delay and limited iterations', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="render on a:poll"></h3>
          <button id="action-el" hc-action="poll on click">poll</button>
        </div>
      `,
    onLoaded: js`
        window.__execCounters = [];
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            poll: {
              handle: async ({ data, execute }) => {
                data.count++;
                execute("polling", 50, (counter) => {
                  window.__execCounters.push(counter);
                }, 3);
              }
            }
          },
          effects: {
            render: {
              handle: ({ data, el }) => { el.textContent = data.count; }
            }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  // Wait for 3 re-executions at 50ms each + buffer
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))

  // times=3: 1 initial + 3 re-executions = 4 total handler runs
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '4')
      throw new Error('should be 4, got: ' + document.querySelector('#effect-el')?.textContent);
  })

  // callback fires on each execute call (including the terminal one that doesn't re-trigger)
  const counters = await page.evaluate(() => (window as any).__execCounters as number[]);
  expect(counters).toEqual([1, 2, 3, 4]);

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-el']
  })
})

test('circular action detection throws on self-referencing trigger', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <button id="action-circular" hc-action="count on a:count">circular</button>
        </div>
      `,
    onLoaded: js`
        window.__circularError = null;
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            count: {
              handle: ({ data }) => { data.count++; }
            }
          },
          effects: {}
        }));
      `
  })

  // Wait for unhandled promise rejection to propagate
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

  // Check both pageerror and console error channels
  const circularError = errors.find(e => e.includes('circular action detected'));
  expect(circularError, 'circular action should throw, got: ' + JSON.stringify(errors)).toBeTruthy();
})

test('multiple triggers with and/or/semicolon combinators', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="render on a:save"></h3>
          <input id="action-multi" hc-action="save and validate on click or blur" />
          <button id="action-semi" hc-action="highlight on mouseenter; unhighlight on mouseleave">hover</button>
        </div>
      `,
    onLoaded: js`
        window.__log = [];
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            save: { handle: ({ data }) => { data.count++; window.__log.push('save'); } },
            validate: { handle: () => { window.__log.push('validate'); } },
            highlight: { handle: () => { window.__log.push('highlight'); } },
            unhighlight: { handle: () => { window.__log.push('unhighlight'); } }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = data.count; } }
          }
        }));
      `
  })

  // Click triggers both save AND validate
  await page.evaluate(() => (document.querySelector('#action-multi') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '1')
      throw new Error('save effect should show 1');
  })
  let log = await page.evaluate(() => (window as any).__log as string[]);
  expect(log).toContain('save');
  expect(log).toContain('validate');

  // Blur also triggers both save AND validate (or combinator)
  await page.evaluate(() => {
    (window as any).__log = [];
    (document.querySelector('#action-multi') as HTMLElement).focus();
    (document.querySelector('#action-multi') as HTMLElement).blur();
  })
  log = await page.evaluate(() => (window as any).__log as string[]);
  expect(log).toContain('save');
  expect(log).toContain('validate');

  // Semicolon: mouseenter triggers highlight, mouseleave triggers unhighlight
  await page.evaluate(() => {
    (window as any).__log = [];
    const btn = document.querySelector('#action-semi') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('mouseenter'));
  })
  log = await page.evaluate(() => (window as any).__log as string[]);
  expect(log).toEqual(['highlight']);

  await page.evaluate(() => {
    (window as any).__log = [];
    const btn = document.querySelector('#action-semi') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('mouseleave'));
  })
  log = await page.evaluate(() => (window as any).__log as string[]);
  expect(log).toEqual(['unhighlight']);

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-multi', 'action-semi']
  })
})

test('dynamic context fragments added after start are wired up', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-static" hctx="counter">
          <h3 id="effect-static" hc-effect="render on a:inc"></h3>
          <button id="action-static" hc-action="inc on click">+1</button>
        </div>
        <div id="container"></div>
      `,
    onLoaded: js`
        hctx.newCtx("counter", () => ({
          data: { count: 0 },
          actions: {
            inc: { handle: ({ data }) => { data.count++; } }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = data.count; } }
          }
        }));
      `
  })

  // Click static fragment
  await page.evaluate(() => (document.querySelector('#action-static') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-static')?.textContent !== '1')
      throw new Error('static effect should show 1');
  })

  // Dynamically add a new fragment of the same context
  await page.evaluate(() => {
    const container = document.querySelector('#container')!;
    container.innerHTML = `
      <div id="ctx-dynamic" hctx="counter">
        <h3 id="effect-dynamic" hc-effect="render on a:inc"></h3>
        <button id="action-dynamic" hc-action="inc on click">+1</button>
      </div>
    `;
  })
  // Wait for MutationObserver
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))

  // Click dynamic fragment — both fragments share data, both effects update
  await page.evaluate(() => (document.querySelector('#action-dynamic') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-static')?.textContent !== '2')
      throw new Error('static effect should show 2, got: ' + document.querySelector('#effect-static')?.textContent);
    if (document.querySelector('#effect-dynamic')?.textContent !== '2')
      throw new Error('dynamic effect should show 2, got: ' + document.querySelector('#effect-dynamic')?.textContent);
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-static', 'ctx-dynamic'],
    idToCheck: ['ctx-static', 'effect-static', 'action-static', 'ctx-dynamic', 'effect-dynamic', 'action-dynamic']
  })
})

test('element cloning: actions get clone by default, useRawElement gets live element', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <button id="action-clone" hc-action="mutateClone on click">clone</button>
          <button id="action-raw" hc-action="mutateRaw on click">raw</button>
        </div>
      `,
    onLoaded: js`
        hctx.newCtx("context", () => ({
          data: {},
          actions: {
            mutateClone: {
              handle: ({ el }) => {
                el.setAttribute('data-modified', 'true');
              }
            },
            mutateRaw: {
              handle: ({ el }) => {
                el.setAttribute('data-modified', 'true');
              },
              useRawElement: true
            }
          },
          effects: {}
        }));
      `
  })

  // Clone: mutation should NOT affect the real DOM element
  await page.evaluate(() => (document.querySelector('#action-clone') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#action-clone')?.hasAttribute('data-modified'))
      throw new Error('cloned element mutation should not affect DOM');
  })

  // Raw: mutation SHOULD affect the real DOM element
  await page.evaluate(() => (document.querySelector('#action-raw') as HTMLElement).click())
  await page.evaluate(() => {
    if (!document.querySelector('#action-raw')?.hasAttribute('data-modified'))
      throw new Error('raw element mutation should affect DOM');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'action-clone', 'action-raw']
  })
})

test('store write traps in effects', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-trap" hc-effect="trapWrite on a:testTrap"></h3>
          <h3 id="effect-read" hc-effect="readOnly on a:testRead"></h3>
          <button id="action-trap" hc-action="testTrap on click">trap</button>
          <button id="action-read" hc-action="testRead on click">read</button>
        </div>
      `,
    onLoaded: js`
        const myStore = hctx.newStore(() => ({ value: 'initial' }));
        hctx.newCtx("context", () => ({
          data: {},
          actions: {
            testTrap: { handle: ({ useStore }) => {
              const store = useStore(myStore);
              store.value = 'updated';
            }},
            testRead: { handle: ({ useStore }) => {
              const store = useStore(myStore);
              store.value = 'read-test';
            }}
          },
          effects: {
            trapWrite: {
              handle: ({ el, useStore }) => {
                const store = useStore(myStore);
                el.textContent = 'before';
                store.value = 'hacked';
                el.textContent = 'after';
              }
            },
            readOnly: {
              handle: ({ el, useStore }) => {
                const store = useStore(myStore);
                el.textContent = store.value;
              }
            }
          }
        }));
      `
  })

  // Test 1: store write in effect should throw
  await page.evaluate(() => (document.querySelector('#action-trap') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-trap')?.textContent !== 'before')
      throw new Error('trap effect should stop at before, got: ' + document.querySelector('#effect-trap')?.textContent);
  })
  const storeError = errors.find(e => e.includes('writes not allowed'));
  expect(storeError, 'store write trap should throw').toBeTruthy();

  // Test 2: store read in effect should work
  await page.evaluate(() => (document.querySelector('#action-read') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-read')?.textContent !== 'read-test')
      throw new Error('read effect should show read-test, got: ' + document.querySelector('#effect-read')?.textContent);
  })
})

test('details.trigger and details.contextTag are accessible in handlers', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="myCtx#myTag">
          <h3 id="effect-el" hc-effect="capture on a:fire"></h3>
          <button id="action-el" hc-action="fire on click">fire</button>
        </div>
      `,
    onLoaded: js`
        window.__details = {};
        hctx.newCtx("myCtx", () => ({
          data: {},
          actions: {
            fire: {
              handle: ({ details }) => {
                window.__details.actionTrigger = details.trigger;
                window.__details.actionTag = details.contextTag;
              }
            }
          },
          effects: {
            capture: {
              handle: ({ details, el }) => {
                window.__details.effectTrigger = details.trigger;
                window.__details.effectTag = details.contextTag;
                el.textContent = 'done';
              }
            }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== 'done')
      throw new Error('effect should have run');
  })

  const details = await page.evaluate(() => (window as any).__details);
  expect(details.actionTrigger).toBe('click');
  expect(details.actionTag).toBe('myTag');
  expect(details.effectTrigger).toContain('hc:action:fire@myCtx#myTag');
  expect(details.effectTag).toBe('myTag');

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-el']
  })
})

test('context-level middleware applies to all actions and effects', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="render on a:inc"></h3>
          <button id="action-inc" hc-action="inc on click">inc</button>
          <button id="action-dec" hc-action="dec on click">dec</button>
        </div>
      `,
    onLoaded: js`
        window.__midCalls = [];
        const logger = ({ type, details }) => {
          window.__midCalls.push(type);
        };
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          options: { middleware: [logger] },
          actions: {
            inc: { handle: ({ data }) => { data.count++; } },
            dec: { handle: ({ data }) => { data.count--; } }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = data.count; } }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-inc') as HTMLElement).click())
  await page.evaluate(() => (document.querySelector('#action-dec') as HTMLElement).click())

  const midCalls = await page.evaluate(() => (window as any).__midCalls as string[]);
  // Context-level middleware should fire for both actions and the effect
  expect(midCalls.filter((c: string) => c === 'action').length).toBeGreaterThanOrEqual(2);
  expect(midCalls.filter((c: string) => c === 'effect').length).toBeGreaterThanOrEqual(1);

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-inc', 'action-dec']
  })
})

test('async middleware blocks execution', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="context">
          <h3 id="effect-el" hc-effect="render on a:guarded"></h3>
          <button id="action-el" hc-action="guarded on click">go</button>
        </div>
      `,
    onLoaded: js`
        window.__actionRan = false;
        const asyncGuard = async ({ type }) => {
          await new Promise(r => setTimeout(r, 20));
          return false;
        };
        hctx.newCtx("context", () => ({
          data: { count: 0 },
          actions: {
            guarded: {
              handle: ({ data }) => { data.count++; window.__actionRan = true; },
              middleware: [asyncGuard]
            }
          },
          effects: {
            render: { handle: ({ data, el }) => { el.textContent = data.count; } }
          }
        }));
      `
  })

  await page.evaluate(() => (document.querySelector('#action-el') as HTMLElement).click())
  // Wait for async middleware to complete
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))

  const actionRan = await page.evaluate(() => (window as any).__actionRan);
  expect(actionRan, 'async middleware should block action').toBe(false);

  await page.evaluate(() => {
    if (document.querySelector('#effect-el')?.textContent !== '')
      throw new Error('effect should not have fired');
  })

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'effect-el', 'action-el']
  })
})

test('cross-context @ subscriber cleanup on element removal', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-a" hctx="ctxA">
          <button id="action-a" hc-action="notify on click">notify</button>
        </div>
        <div id="ctx-b" hctx="ctxB">
          <h3 id="effect-b" hc-effect="listen on a:notify@ctxA"></h3>
        </div>
      `,
    onLoaded: js`
        window.__effectCount = 0;
        hctx.newCtx("ctxA", () => ({
          data: {},
          actions: { notify: { handle: () => {} } },
          effects: {}
        }));
        hctx.newCtx("ctxB", () => ({
          data: {},
          actions: {},
          effects: {
            listen: { handle: ({ el }) => { window.__effectCount++; el.textContent = window.__effectCount; } }
          }
        }));
      `
  })

  // Fire action — effect in ctxB should respond
  await page.evaluate(() => (document.querySelector('#action-a') as HTMLElement).click())
  let count = await page.evaluate(() => (window as any).__effectCount);
  expect(count).toBe(1);

  // Remove ctxB — cleanup should unregister from ctxA's subscribers
  await page.evaluate(() => document.querySelector('#ctx-b')?.remove())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))

  // Fire action again — removed effect should NOT respond
  await page.evaluate(() => {
    (window as any).__effectCount = 0;
    (document.querySelector('#action-a') as HTMLElement).click();
  })
  count = await page.evaluate(() => (window as any).__effectCount);
  expect(count, 'removed cross-context effect should not fire').toBe(0);
})

test('multi-property subscription with details.trigger branching', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="profile">
          <h3 id="name-display" hc-effect="renderName on hc:statechanged"></h3>
          <h3 id="email-display" hc-effect="renderEmail on hc:statechanged"></h3>
          <h3 id="trigger-log" hc-effect="logTrigger on hc:statechanged"></h3>
          <button id="set-name" hc-action="setName on click">name</button>
          <button id="set-email" hc-action="setEmail on click">email</button>
        </div>
      `,
    onLoaded: js`
        window.__triggers = [];
        hctx.newCtx("profile", () => ({
          data: { name: "", email: "" },
          actions: {
            setName: { handle: ({ data }) => { data.name = "Alice"; } },
            setEmail: { handle: ({ data }) => { data.email = "alice@test.com"; } }
          },
          effects: {
            renderName: {
              handle: ({ data, el }) => { el.textContent = data.name; },
              subscribe: ({ add, data }) => { add(data, "name"); }
            },
            renderEmail: {
              handle: ({ data, el }) => { el.textContent = data.email; },
              subscribe: ({ add, data }) => { add(data, "email"); }
            },
            logTrigger: {
              handle: ({ details }) => {
                window.__triggers.push(details.trigger);
              },
              subscribe: ({ add, data }) => {
                add(data, "name");
                add(data, "email");
              }
            }
          }
        }));
      `
  })

  // Set name — only name subscription fires, email stays empty
  await page.evaluate(() => (document.querySelector('#set-name') as HTMLElement).click())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))

  let result = await page.evaluate(() => ({
    name: document.querySelector('#name-display')?.textContent,
    email: document.querySelector('#email-display')?.textContent,
    triggers: (window as any).__triggers.slice()
  }));
  expect(result.name).toBe('Alice');
  expect(result.email).toBe('');
  expect(result.triggers).toEqual(['hc:statechanged:name']);

  // Set email — only email subscription fires
  await page.evaluate(() => (document.querySelector('#set-email') as HTMLElement).click())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))

  result = await page.evaluate(() => ({
    name: document.querySelector('#name-display')?.textContent,
    email: document.querySelector('#email-display')?.textContent,
    triggers: (window as any).__triggers.slice()
  }));
  expect(result.name).toBe('Alice');
  expect(result.email).toBe('alice@test.com');
  expect(result.triggers).toEqual(['hc:statechanged:name', 'hc:statechanged:email']);

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'name-display', 'email-display', 'trigger-log', 'set-name', 'set-email']
  })
})

test('store subscription via useStore in subscribe callback', async () => {
  const browser = await chromium.launch({
    headless: true,
    devtools: true
  });
  const page = await browser.newPage();

  await util.preparePage(page, {
    html: html`
        <div id="ctx-el" hctx="viewer">
          <h3 id="display" hc-effect="render on hc:statechanged"></h3>
          <button id="update-btn" hc-action="updateTheme on click">toggle</button>
        </div>
      `,
    onLoaded: js`
        const themeStore = hctx.newStore(() => ({ mode: "light" }));

        hctx.newCtx("viewer", () => ({
          data: {},
          actions: {
            updateTheme: {
              handle: ({ useStore }) => {
                const store = useStore(themeStore);
                store.mode = store.mode === "light" ? "dark" : "light";
              }
            }
          },
          effects: {
            render: {
              handle: ({ el, useStore }) => {
                const store = useStore(themeStore);
                el.textContent = store.mode;
              },
              subscribe: ({ add, useStore }) => {
                const store = useStore(themeStore);
                add(store, "mode");
              }
            }
          }
        }));
      `
  })

  // No initial render — subscription only fires on mutation
  // Click toggle — store changes, subscription fires
  await page.evaluate(() => (document.querySelector('#update-btn') as HTMLElement).click())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))
  let text = await page.evaluate(() => document.querySelector('#display')?.textContent);
  expect(text).toBe('dark');

  // Click again — toggles back
  await page.evaluate(() => (document.querySelector('#update-btn') as HTMLElement).click())
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)))
  text = await page.evaluate(() => document.querySelector('#display')?.textContent);
  expect(text).toBe('light');

  await util.checkMemoryLeaks(page, {
    idsToRemove: ['ctx-el'],
    idToCheck: ['ctx-el', 'display', 'update-btn']
  })
})

