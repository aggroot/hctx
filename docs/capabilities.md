# hctx - Capabilities Reference

> A tiny language framework for embedding JavaScript in hypermedia.

hctx adds declarative, reactive client-side behavior to server-rendered HTML via HTML attributes. It is designed to complement HTMX and similar hypermedia tools, no virtual DOM, no SPA framework required.

---

## Table of Contents

1. [Lifecycle & Boot Sequence](#1-lifecycle--boot-sequence)
2. [Contexts](#2-contexts)
3. [Fragments (Context Composition)](#3-fragments-context-composition)
4. [Actions](#4-actions)
5. [Effects](#5-effects)
6. [Attribute DSL](#6-attribute-dsl)
7. [Triggers](#7-triggers)
8. [Subscriptions & Reactivity](#8-subscriptions--reactivity)
9. [Tags (`#` syntax)](#9-tags--syntax)
10. [Local Actions (`$` prefix)](#10-local-actions--prefix)
11. [Cross-Context Triggers (`@` syntax)](#11-cross-context-triggers--syntax)
12. [Nested Contexts](#12-nested-contexts)
13. [Action Phases (before/after)](#13-action-phases-beforeafter)
14. [Async Actions & Effects](#14-async-actions--effects)
15. [Stores](#15-stores)
16. [Middleware](#16-middleware)
17. [Props](#17-props)
18. [Write Traps](#18-write-traps)
19. [Element Cloning](#19-element-cloning)
20. [Cleanup (`onCleanup`)](#20-cleanup-oncleanup)
21. [Action Re-execution (`execute`)](#21-action-re-execution-execute)
22. [Dynamic Elements (MutationObserver)](#22-dynamic-elements-mutationobserver)
23. [Auto-Import](#23-auto-import)
24. [Circular Action Detection](#24-circular-action-detection)
25. [Options Reference](#25-options-reference)

---

## 1. Lifecycle & Boot Sequence

hctx boots in two phases:

### `load()`

Registers the `hctx` object on `window` and dispatches the `hc:loaded` event on `document`. In the IIFE build this is called automatically. In the ESM build it is called on import.

### `start(options?)`

Initializes the framework:

1. Parses options (custom attribute names, dev mode, import callbacks).
2. Queries all `[hctx]` elements in the DOM.
3. Auto-imports any unregistered context modules.
4. Processes each context element, wires up actions and effects.
5. Activates state subscriptions.
6. Dispatches the `hc:started` event on `document`.

### Boot order in user code

```html
<script src="hctx/iife.global.js" defer></script>
<script>
  document.addEventListener('hc:loaded', () => {
    hctx.newCtx("myCtx", () => ({ ... }));
    hctx.start();
  });
</script>
```

---

## 2. Contexts

A context is a named state container attached to a DOM element. It has three parts: **data**, **actions**, and **effects**.

### Registering a context

**Inline (IIFE/script):**

```js
hctx.newCtx("counter", () => ({
  data: { count: 0 },
  actions: {
    increment: ({ data }) => { data.count++; }
  },
  effects: {
    render: ({ data, el }) => { el.textContent = data.count; }
  }
}));
```

**Module (ESM with auto-import):**

```ts
// counter.ctx.ts
import { defineContext } from "hctx";

export default defineContext(() => ({
  data: { count: 0 },
  actions: { ... },
  effects: { ... }
}));
```

`defineContext` is an identity function that provides type inference. The module must export the callback as `default`.

### Attaching to the DOM

```html
<div hctx="counter">
  <!-- actions and effects go here -->
</div>
```

Each unique `hctx` attribute value gets its own context instance. The context callback factory is called once per unique name. A context can appear at **multiple DOM locations**, and each occurrence is called a **fragment**. See the next section.

---

## 3. Fragments (Context Composition)

A context is defined once but can appear **multiple times** in the DOM. Each `[hctx="name"]` element becomes a **fragment**, a DOM location that participates in the same shared context. All fragments of a context share the same `data`, `actions`, and `effects`. This is a core design concept: a single context is **composed across multiple DOM locations**.

### Basic example

One context definition, three fragments scattered across the page:

```html
<!-- Header fragment -->
<nav>
  <div hctx="cart">
    <span hc-effect="renderCount on hc:statechanged"></span>
  </div>
</nav>

<!-- Product listing fragment -->
<main>
  <div hctx="cart">
    <button hc-action="addItem on click">Add to Cart</button>
  </div>
</main>

<!-- Sidebar fragment -->
<aside>
  <div hctx="cart">
    <ul hc-effect="renderItems on hc:statechanged"></ul>
  </div>
</aside>
```

```js
hctx.newCtx("cart", () => ({
  data: { items: [], count: 0 },
  actions: {
    addItem: ({ data }) => { data.count++; data.items.push("item"); }
  },
  effects: {
    renderCount: {
      handle: ({ data, el }) => { el.textContent = data.count; },
      subscribe: ({ add, data }) => { add(data, "count"); }
    },
    renderItems: {
      handle: ({ data, el }) => { el.innerHTML = data.items.map(i => `<li>${i}</li>`).join(""); },
      subscribe: ({ add, data }) => { add(data, "items"); }
    }
  }
}));
```

When the button in `<main>` fires `addItem`:
- The `<span>` in `<nav>` updates (renderCount).
- The `<ul>` in `<aside>` updates (renderItems).

All three fragments operate on the **same data object**. The context is defined once, but its UI is distributed across the page.

### How actions dispatch across fragments

When a non-`$` action fires, effects in **every fragment** that listen to that action are notified. This is the default behavior, and all fragments act as one.

State subscriptions (`hc:statechanged`) are also inherently global since all fragments share the same `data` object.

To scope an action to a single fragment, use the `$` prefix. See [Local Actions](#10-local-actions--prefix).

### Dynamic fragments

New fragments can be added dynamically (e.g., via HTMX swaps). hctx detects new `[hctx]` elements, creates new fragment entries, and wires them into the existing context. See [Dynamic Elements](#22-dynamic-elements-mutationobserver).

### Fragments vs Tags

| | Fragments | Tags (`#`) |
|---|---|---|
| **Purpose** | Compose one context across multiple DOM locations | Create independent instances of the same context definition |
| **Data** | Shared, same object | Separate, each tag gets its own data |
| **Syntax** | `hctx="cart"` repeated | `hctx="cart#first"`, `hctx="cart#second"` |
| **Use case** | Header cart count + sidebar cart list + checkout button all wired together | Two independent counters on the same page |

---

## 4. Actions

Actions **mutate state**. They receive the raw `data` object and can write to it freely.

### Simple form

```js
actions: {
  increment: ({ data }) => { data.count++; }
}
```

### Object form (with options)

```js
actions: {
  increment: {
    handle: ({ data, el, execute, useStore, onCleanup, details, event }) => {
      data.count++;
    },
    subscribe: ({ add, data, useStore }) => { ... },
    middleware: [myMiddleware],
    useRawElement: true,
  }
}
```

### Action context (`actionCtx`)

| Property | Type | Description |
|---|---|---|
| `data` | `D` | The context's reactive state (mutable) |
| `el` | `HTMLElement` | The triggering element (cloned by default, see [Element Cloning](#19-element-cloning)) |
| `execute` | `ActionCallback` | Re-execute this action (see [Action Re-execution](#21-action-re-execution-execute)) |
| `useStore` | `(store) => T` | Access a shared store (see [Stores](#15-stores)) |
| `onCleanup` | `(cb) => void` | Register a cleanup callback (see [Cleanup](#20-cleanup-oncleanup)) |
| `details` | `ContextDetails` | Execution metadata (trigger, phase, tag, isLocal) |
| `event` | `Event?` | The originating DOM event, if any |

### Wiring to the DOM

```html
<button hc-action="increment on click">+1</button>
```

---

## 5. Effects

Effects **read state and update the DOM**. By default they receive a write-trapped proxy of `data` that throws on mutation (see [Write Traps](#18-write-traps)).

### Simple form

```js
effects: {
  render: ({ data, el }) => { el.textContent = data.count; }
}
```

### Object form (with options)

```js
effects: {
  render: {
    handle: ({ data, el, useStore, onCleanup, details, event }) => {
      el.textContent = data.count;
    },
    subscribe: ({ add, data, useStore }) => {
      add(data, "count");
    },
    allowStateMutations: true,
    middleware: [myMiddleware],
  }
}
```

### Effect context (`effectCtx`)

| Property | Type | Description |
|---|---|---|
| `data` | `D` | The context's state (read-only by default) |
| `el` | `HTMLElement` | The actual DOM element (not cloned) |
| `useStore` | `(store) => T` | Access a shared store (write-trapped by default) |
| `onCleanup` | `(cb) => void` | Register a cleanup callback |
| `details` | `ContextDetails` | Execution metadata |
| `event` | `Event?` | The originating DOM event, if any |

### Wiring to the DOM

```html
<span hc-effect="render on a:increment">0</span>
```

---

## 6. Attribute DSL

The `hc-action` and `hc-effect` attributes support a mini-language.

### Grammar

```
attribute    = declaration { ";" declaration }
declaration  = names " on " triggers
names        = name { " and " name }
triggers     = trigger { " or " trigger }
name         = identifier [ ":" json_props ] [ "#" tag ] [ "@" ctxName ]
trigger      = event_name | "hc:loaded" | "hc:mutated" | "hc:statechanged"
             | "a:" action_name [ ":" phase ] [ "@" ctxName ]
```

### Examples

```html
<!-- Single action on click -->
<button hc-action="increment on click">

<!-- Multiple actions on multiple triggers -->
<div hc-action="save and validate on click or blur">

<!-- Two independent declarations -->
<div hc-action="highlight on mouseenter; unhighlight on mouseleave">

<!-- With JSON props -->
<button hc-action='count:{"step":5} on click'>

<!-- Cross-context trigger (@ only works on trigger side) -->
<span hc-effect="showSuccess on a:save@formCtx">

<!-- Local (fragment-scoped) action -->
<button hc-action="$localSave on click">

<!-- Effect on action completion -->
<span hc-effect="render on a:increment">

<!-- Effect on action phase -->
<span hc-effect="showSpinner on a:save:before; hideSpinner on a:save:after">

<!-- Effect on state change (requires subscribe) -->
<span hc-effect="render on hc:statechanged">

<!-- Effect on page load -->
<div hc-effect="init on hc:loaded">

<!-- Effect on dynamic insertion (via MutationObserver) -->
<div hc-effect="setup on hc:mutated">
```

---

## 7. Triggers

### DOM event triggers

Any valid DOM event name: `click`, `input`, `change`, `submit`, `keydown`, `mouseenter`, `blur`, etc. These are registered via `addEventListener` on the element.

### `hc:loaded`

Fires once during `start()` for elements present at boot time. Does **not** fire for dynamically added elements.

### `hc:mutated`

Fires once when the element is added to the DOM **after** `start()` (via the MutationObserver). Does **not** fire for elements present at boot time. This is the counterpart to `hc:loaded` for dynamically inserted content (e.g., HTMX swaps).

### `hc:statechanged`

Fires when subscribed data properties change. Requires a `subscribe` function on the action/effect definition. See [Subscriptions & Reactivity](#8-subscriptions--reactivity).

### `a:actionName` (action trigger)

Fires when the named action completes. Supports phases:

- `a:actionName` or `a:actionName:after`: after the action handler runs
- `a:actionName:before`: before the action handler runs

Supports cross-context references: `a:actionName@otherCtx`.

---

## 8. Subscriptions & Reactivity

The subscription system enables fine-grained reactivity. Effects (or actions) with a `subscribe` function track which data properties to watch. When those properties change, the effect re-runs automatically.

hctx watches subscribed objects for writes and re-runs subscribed effects automatically. Subscriptions activate after `start()` completes.

### Defining subscriptions

The `subscribe` callback receives `{ add, data, useStore }`. Call `add(object, property?)` to watch a specific property, or `add(object)` to watch all properties on an object.

### Property-level subscription

```js
subscribe: ({ add, data }) => {
  add(data.counter, "count");  // only fires when data.counter.count changes
}
```

### Object-level subscription

```js
subscribe: ({ add, data }) => {
  add(data.counter);  // fires when any property of data.counter changes
}
```

### Multiple subscriptions

A single effect can subscribe to multiple properties:

```js
subscribe: ({ add, data }) => {
  add(data.user, "name");
  add(data.user, "email");
  add(data.settings, "theme");
}
```

The effect re-runs whenever any of those three properties change.

### Named triggers (`details.trigger`)

When a subscribed property changes, `details.trigger` contains the specific property name that caused the effect to fire, in the format `hc:statechanged:propertyName`. The `details.initTrigger` always stays as `hc:statechanged` (the original attribute trigger).

The subscription (`add()`) controls **whether** the effect fires. The named trigger tells you **why** it fired. This lets you branch inside a single effect that subscribes to multiple properties:

```js
effects: {
  update: {
    handle: ({ data, el, details }) => {
      if (details.trigger === "hc:statechanged:name") {
        el.querySelector(".name").textContent = data.name;
      }
      if (details.trigger === "hc:statechanged:email") {
        el.querySelector(".email").textContent = data.email;
      }
    },
    subscribe: ({ add, data }) => {
      add(data, "name");
      add(data, "email");
    }
  }
}
```

Object-level subscriptions (`add(data.counter)` with no second argument) also receive named triggers, and `details.trigger` will be `hc:statechanged:count` reflecting the actual property that was written.

Note: `hc:statechanged:propertyName` is only available inside `details.trigger` at runtime. It cannot be used as an HTML attribute trigger. The attribute must be `hc:statechanged` (without a suffix).

### Store subscriptions

```js
subscribe: ({ add, useStore }) => {
  const store = useStore(myStore);
  add(store, "value");
}
```

See [Stores](#15-stores) for more on shared state.

---

## 9. Tags (`#` syntax)

Tags create **independent instances** of the same context definition. Each tagged instance gets its own data, so the instances don't share state.

```html
<div hctx="counter#first">
  <span hc-effect="render on hc:statechanged"></span>
  <button hc-action="increment on click">+1</button>
</div>

<div hctx="counter#second">
  <span hc-effect="render on hc:statechanged"></span>
  <button hc-action="increment on click">+1</button>
</div>
```

Clicking "+1" in `counter#first` only increments the first counter. `counter#second` is completely independent, with separate data and separate subscriptions.

The tag is available in action/effect handlers via `details.contextTag`.

Actions also support tags in the attribute: `hc-action="action#tag on click"`.

---

## 10. Local Actions (`$` prefix)

Actions prefixed with `$` are scoped to a single **fragment** rather than the entire context. This is the opt-out mechanism from the default fragment composition behavior described in [Fragments](#3-fragments-context-composition).

By default, all fragments of a context share everything, so an action in any fragment notifies effects in all fragments. Local actions break this: they stay contained within the fragment where they are defined.

```html
<!-- Fragment 1 -->
<div hctx="counter">
  <button hc-action="$localIncrement on click">+1</button>
  <span hc-effect="render on a:localIncrement"></span>
</div>

<!-- Fragment 2 - has its own independent $localIncrement -->
<div hctx="counter">
  <button hc-action="$localIncrement on click">+1</button>
  <span hc-effect="render on a:localIncrement"></span>
</div>
```

Clicking the button in Fragment 1 only triggers the effect in Fragment 1. Fragment 2 is unaffected, even though both belong to the same context.

Note: The `$` prefix appears on the **action side** (`hc-action="$localIncrement"`). Effect triggers reference the action name **without** the `$`: `a:localIncrement`.

### How local dispatch works

- When a `$` action fires, only effects **within the same fragment** that listen to that action name are notified.
- When a non-`$` action fires, effects in **every fragment** of the context are notified.

### State subscriptions are still global

The `$` prefix only affects action subscriber dispatch. State subscriptions (`hc:statechanged`) are inherently global because all fragments share the same `data` object. If a local action mutates `data`, any state-subscribed effect in any fragment will still re-run.

### Tags vs Local Actions: when to use which

Both tags and local actions address the problem of multiple instances on a page, but they solve different aspects:

**Tags (`#`)** = separate data

Use tags when you need a **reusable context with isolated scope**. Each tagged instance has its own `data` object, so mutations in one instance don't affect the other. This is intended for placing the same context definition on a page multiple times, each with independent state.

```html
<!-- Two fully independent counters -->
<div hctx="counter#a">
  <button hc-action="increment on click">+1</button>
  <span hc-effect="render on hc:statechanged"></span>
</div>
<div hctx="counter#b">
  <button hc-action="increment on click">+1</button>
  <span hc-effect="render on hc:statechanged"></span>
</div>
```

**Local actions (`$`)** = shared data, scoped triggers

Use local actions when instances should **share state** but have **independent UI behavior**. Two panels that read from the same data but toggle independently:

```html
<!-- Two panels sharing data, toggling independently -->
<div hctx="panel">
  <button hc-action="$toggle on click">Toggle</button>
  <div hc-effect="show on a:toggle"></div>
</div>
<div hctx="panel">
  <button hc-action="$toggle on click">Toggle</button>
  <div hc-effect="show on a:toggle"></div>
</div>
```

**Both together**: Use tags for independent data with local actions for fragment-scoped UI actions within each tag:

```html
<div hctx="dashboard#sales">
  <button hc-action="$expandChart on click">Expand</button>
  <div hc-effect="renderChart on hc:statechanged"></div>
</div>
<div hctx="dashboard#traffic">
  <button hc-action="$expandChart on click">Expand</button>
  <div hc-effect="renderChart on hc:statechanged"></div>
</div>
```

Each dashboard has independent data (tags) and independent expand/collapse behavior (local actions).

---

## 11. Cross-Context Triggers (`@` syntax)

The `@` syntax allows effects and actions to **listen to** actions from other contexts. It works exclusively on the **trigger side**, the part after `on` in `hc-effect` and `hc-action` attributes.

Each context owns its own actions. You cannot call or borrow an action from another context. `@` is only for subscribing to another context's action events.

### What works: `@` on the trigger side

**Effect listening to an external action:**

```html
<div hctx="formCtx">
  <button hc-action="submit on click">Submit</button>
</div>

<div hctx="notificationCtx">
  <!-- This effect runs when formCtx's "submit" action fires -->
  <div hc-effect="showSuccess on a:submit@formCtx"></div>
</div>
```

**Action chained to an external action trigger:**

```html
<div hctx="ctxA">
  <button hc-action="doA on click">Do A</button>
</div>

<div hctx="ctxB">
  <!-- ctxB's "doB" fires whenever ctxA's "doA" fires -->
  <button hc-action="doB on a:doA@ctxA"></button>
</div>
```

### What does NOT work: `@` on the action name

```html
<div hctx="ctxA">
  <!-- WRONG: this does NOT call ctxB's "doSomething" -->
  <button hc-action="doSomething@ctxB on click"></button>
</div>
```

Putting `@ctxB` on the action name does not borrow or delegate the action to another context. Actions are always defined and owned by the context they appear in.

### Cleanup

When elements with cross-context triggers are removed from the DOM, their subscriptions to the external context are automatically cleaned up.

---

## 12. Nested Contexts

Context elements can be nested inside other context elements. Each context is self-contained with its own data, actions, and effects.

```html
<div hctx="outer">
  <h2 hc-effect="renderOuter on hc:statechanged"></h2>
  <div hctx="inner">
    <h3 hc-effect="renderInner on hc:statechanged"></h3>
    <button hc-action="doInner on click">Inner</button>
  </div>
  <button hc-action="doOuter on click">Outer</button>
</div>
```

Nested contexts are processed depth-first. Each action and effect element belongs to exactly one context, and inner context elements are never claimed by the outer context.

---

## 13. Action Phases (before/after)

Effects can subscribe to specific phases of an action's execution.

```html
<div hc-effect="showSpinner on a:save:before"></div>
<div hc-effect="hideSpinner on a:save:after"></div>
```

### Phases

- **`before`**: Fires after middleware passes but before the action handler runs.
- **`after`**: Fires after the action handler completes (this is the default if no phase is specified).

For async actions, `before` fires just before the handler promise starts, and `after` fires after it resolves.

---

## 14. Async Actions & Effects

Actions and effects can be `async`.

### Async action

```js
actions: {
  fetchData: {
    handle: async ({ data }) => {
      const res = await fetch("/api/data");
      data.items = await res.json();
    }
  }
}
```

### Concurrent execution prevention

When an async action or effect is running on a specific element, triggering the same action again on that element is **silently skipped** until the first call completes. This prevents race conditions from double-clicks or rapid triggers.

### Execution flow (async)

1. Execute middleware chain (awaited sequentially).
2. If middleware passes, notify `before` phase subscribers.
3. Await the action/effect handler.
4. Notify `after` phase subscribers (actions only).

---

## 15. Stores

Stores are **global reactive state** shared across contexts. They are created outside of any context and accessed inside actions/effects via `useStore`.

### Creating a store

```js
import { newStore } from "hctx";

const appStore = newStore(() => ({
  user: null,
  theme: "light",
}));
```

`newStore` returns a `{ uid, handle }` object. The factory function is **called lazily** on first access, and the result is cached.

### Using in actions

```js
actions: {
  setTheme: ({ useStore }) => {
    const store = useStore(appStore);
    store.theme = "dark";  // mutable in actions
  }
}
```

### Using in effects

```js
effects: {
  applyTheme: {
    handle: ({ useStore, el }) => {
      const store = useStore(appStore);
      el.className = store.theme;  // read-only by default
    },
    subscribe: ({ add, useStore }) => {
      const store = useStore(appStore);
      add(store, "theme");
    }
  }
}
```

In effects, `useStore` returns a write-trapped proxy (same as `data`), unless `allowStateMutations` is enabled.

---

## 16. Middleware

Middleware functions intercept action/effect execution. They can inspect context, modify behavior, or block execution entirely.

### Creating middleware

```js
import { newMid } from "hctx";

const authGuard = newMid(({ el, details, type }) => {
  if (!isAuthenticated()) return false;  // blocks execution
});
```

`newMid` is an identity function that returns the callback as-is. It exists for semantic clarity and potential future extensions.

### MiddlewareContext

| Property | Type | Description |
|---|---|---|
| `el` | `HTMLElement` | The element being processed |
| `details` | `ContextDetails` | Trigger, phase, tag, isLocal |
| `type` | `"action" \| "effect"` | What is being intercepted |

### Return values

- `undefined` / `void`: execution continues
- `false`: **blocks** the action/effect from running

### Applying middleware

**Context-wide** (applies to all actions and effects):

```js
() => ({
  data: { ... },
  options: { middleware: [authGuard] },
  actions: { ... },
  effects: { ... }
})
```

**Action-level** (applies to all actions):

```js
actions: {
  options: { middleware: [logAction] },
  save: { handle: ... },
}
```

**Per-action/effect:**

```js
actions: {
  save: {
    handle: ({ data }) => { ... },
    middleware: [validateForm],
  }
}
```

Options are merged: context-level is the base, action/effect-level overrides.

### Async middleware

Middleware can be async. If any middleware in the chain is async, the entire execution path switches to promise-based flow.

```js
const asyncGuard = newMid(async ({ el }) => {
  const allowed = await checkPermission();
  if (!allowed) return false;
});
```

---

## 17. Props

Actions and effects can receive static props via JSON embedded in the attribute name.

```html
<button hc-action='count:{"step":5} on click'>+5</button>
```

The `:` separates the action/effect name from the JSON string. The JSON is parsed and passed as the second argument to the handler.

```js
actions: {
  count: {
    handle: ({ data }, props) => {
      data.count += props.step ?? 1;
    }
  }
}
```

If the parsed value is not a plain object, it is replaced with `{}`.

---

## 18. Write Traps

By default, effects receive a **write-trapped proxy** of `data` that throws an error on any mutation attempt:

```
"data writes not allowed within effects by default.
 use allowStateMutations option to activate it."
```

This enforces a unidirectional data flow: **actions mutate → effects read**.

### Disabling the trap

Per-effect:

```js
effects: {
  myEffect: {
    handle: ({ data }) => { data.count++; },  // allowed
    allowStateMutations: true,
  }
}
```

All effects in context:

```js
effects: {
  options: { allowStateMutations: true },
  myEffect: ({ data }) => { data.count++; },  // allowed
}
```

The same write trap applies to stores accessed via `useStore` inside effects.

---

## 19. Element Cloning

By default, action handlers receive `el.cloneNode(true)`, a **deep clone** of the triggering element at the time of invocation. This prevents accidental DOM mutation from within actions.

### Getting the live element

Set `useRawElement: true` at the action level:

```js
actions: {
  options: { useRawElement: true },
  // or per-action:
  myAction: {
    handle: ({ el }) => { el.classList.add("active"); },
    useRawElement: true,
  }
}
```

Effects always receive the **live element** (no cloning).

---

## 20. Cleanup (`onCleanup`)

Both actions and effects receive an `onCleanup` function to register teardown callbacks.

```js
actions: {
  startTimer: {
    handle: ({ data, onCleanup }) => {
      const id = setInterval(() => data.tick++, 1000);
      onCleanup(async () => clearInterval(id));
    }
  }
}
```

### When cleanups run

Cleanup callbacks execute when the element is **removed from the DOM** (detected by the MutationObserver). hctx also uses `onCleanup` internally to remove event listeners and subscription registrations when elements are removed.

---

## 21. Action Re-execution (`execute`)

Every action handler receives an `execute` function that can re-trigger the same action, enabling polling and retry patterns.

```js
actions: {
  poll: {
    handle: async ({ data, execute }) => {
      const res = await fetch("/api/status");
      data.status = await res.json();
      // Re-execute after 5 seconds, up to 10 times
      await execute("polling", 5000, (counter) => {
        console.log(`Poll #${counter}`);
      }, 10);
    }
  }
}
```

### Signature

```ts
execute(
  reason?: string,      // Description of why (default: "execute")
  delay?: number,       // Milliseconds to wait before re-running (default: 200)
  callback?: (counter: number) => void,  // Called each iteration with counter
  times?: number        // Max re-executions (undefined = unlimited)
) => Promise<void>
```

The `reason` string becomes the `trigger` in `ContextDetails` for the re-execution.

---

## 22. Dynamic Elements (MutationObserver)

After `start()`, hctx observes `document.body` for DOM changes. This enables seamless integration with HTMX and other tools that dynamically insert HTML.

### Added nodes

When new nodes are added:
1. Scans for new `[hctx]` elements, auto-imports unregistered contexts, and processes them.
2. Scans for new `[hc-action]`/`[hc-effect]` elements not inside a new context, walks up the DOM to find their parent context, and processes them.
3. Activates state subscriptions.
4. Any `hc:mutated` triggers fire.

### Removed nodes

When nodes are removed:
1. Executes all cleanup callbacks on the removed element and its action/effect descendants.
2. Removes event listeners and unregisters from subscriber sets.

### `hc:mutated` trigger

Use `hc:mutated` instead of `hc:loaded` for elements that are dynamically inserted:

```html
<!-- This is injected by HTMX -->
<div hc-effect="init on hc:mutated"></div>
```

`hc:loaded` only fires during `start()`. `hc:mutated` only fires for elements added after `start()`.

---

## 23. Auto-Import

When `start()` encounters `[hctx]` elements whose context name is not registered, it can dynamically import context modules.

### Configuration

```js
// Path-based (e.g., for Vite)
hctx.start({
  getImportPath: (ctxName) => `/app/routes/${ctxName}.ctx.ts`,
});

// Callback-based (full control)
hctx.start({
  getImportCallback: (ctxName) => () => import(`./contexts/${ctxName}.ts`),
});
```

### Behavior

1. Collects all unique `[hctx]` names that have no registered callback.
2. Calls the import function for each, in parallel.
3. Expects each module to `export default` a context callback function.
4. Registers each automatically.
5. Errors are caught and logged (in dev mode).

This is what powers the `.ctx.tsx` file convention in the hypermeta framework.

---

## 24. Circular Action Detection

If an action element's `a:` trigger references itself, hctx throws:

```
"circular action detected for element <button hc-action='count on a:count'>..."
```

This check occurs at attribute parsing time. If the trigger's action name is among the actions defined on the same element, it's rejected.

---

## 25. Options Reference

Options can be set at multiple levels. Lower levels override higher levels via deep merge.

### `start()` options

```ts
type Options = {
  actionAttr?: string;     // default: "hc-action"
  effectAttr?: string;     // default: "hc-effect"
  ctxAttr?: string;        // default: "hctx"
  isDev?: boolean;         // default: false - enables console.error for missing props etc.
  getImportPath?: (ctxName: string) => string;
  getImportCallback?: (ctxName: string) => ImportCallback;
};
```

### Context-level options

```js
{
  options: {
    middleware: [globalMiddleware],
  }
}
```

### Action-level options

```js
actions: {
  options: {
    middleware: [actionMiddleware],
    useRawElement: true,    // pass live element instead of clone
  }
}
```

### Effect-level options

```js
effects: {
  options: {
    middleware: [effectMiddleware],
    allowStateMutations: true,  // bypass write trap on data
  }
}
```

### Per-action/effect options

Individual actions/effects can also set `middleware`, `useRawElement`, and `allowStateMutations` directly in their object definition.
