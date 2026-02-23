# hctx

[![Bundle Size](https://deno.bundlejs.com/badge?q=hctx@0.1.0)](https://deno.bundlejs.com/result?q=hctx@0.1.0)

A tiny language framework for embedding JavaScript in hypermedia.

~4.8KB gzipped. Zero dependencies. Full TypeScript support.

---

hctx adds client-side state management and DOM reactivity to server-rendered HTML through HTML attributes and plain JavaScript. Purpose-built for the hypermedia architecture, where the server owns the structure and the client manages behavior. No virtual DOM, no template compiler, no component tree.

## Core Concepts

A **context** holds data, actions that mutate it, and effects that read it and update the DOM:

```js
hctx.newCtx("counter", () => ({
  data: { count: 0 },
  actions: {
    increment: ({ data }) => { data.count++; }
  },
  effects: {
    render: {
      handle: ({ data, el }) => { el.textContent = data.count; },
      subscribe: ({ add, data }) => { add(data, "count"); }
    }
  }
}));
```

Wire it to the DOM with attributes:

```html
<div hctx="counter">
  <span hc-effect="render on hc:statechanged">0</span>
  <button hc-action="increment on click">+1</button>
</div>
```

**Actions** mutate state. **Effects** read state and update the DOM (write-protected by default). The `on` keyword separates the name from the trigger: a DOM event (`click`), an action completing (`a:increment`), or a data change (`hc:statechanged`).

## Fragment Composition

The standout capability. A context is defined once but lives at **multiple DOM locations**, each is a fragment, all share the same state:

```html
<nav>
  <div hctx="cart">
    <span hc-effect="renderCount on hc:statechanged">0</span>
  </div>
</nav>

<main>
  <div hctx="cart">
    <button hc-action="addItem on click">Add to Cart</button>
  </div>
</main>

<aside>
  <div hctx="cart">
    <ul hc-effect="renderItems on hc:statechanged"></ul>
  </div>
</aside>
```

One context, three locations, shared state. Click the button in `<main>`, the count in `<nav>` updates, the list in `<aside>` updates. No prop drilling, no event bus, just repeat the `hctx` attribute.

## Attribute DSL

A small language that expresses complex wiring in readable declarations:

```html
<!-- Multiple actions, multiple triggers -->
<button hc-action="save and validate on click or blur">

<!-- Action phases -->
<div hc-effect="showSpinner on a:save:before; hideSpinner on a:save:after">

<!-- Cross-context wiring -->
<span hc-effect="showSuccess on a:submit@formCtx">

<!-- Fragment-scoped actions -->
<button hc-action="$toggle on click">

<!-- Props -->
<button hc-action='increment:{"step":5} on click'>

<!-- Lifecycle triggers -->
<div hc-effect="init on hc:loaded">
<div hc-effect="setup on hc:mutated">
<div hc-effect="render on hc:statechanged">
```

## Two-Tier Reactivity

**State subscribers**: react when data changes, regardless of which action caused it:

```js
effects: {
  renderCount: {
    handle: ({ data, el }) => { el.textContent = data.count; },
    subscribe: ({ add, data }) => { add(data, "count"); }
  }
}
```

**Action subscribers**: react when a specific action runs, regardless of what data changed:

```html
<span hc-effect="showConfirmation on a:save">Saved!</span>
```

## Key Capabilities

- **HTMX-native**: MutationObserver auto-discovers new `hctx` elements from swaps, wires them up, and cleans up on removal
- **Write safety**: effects receive a read-only proxy; accidental mutations throw immediately
- **Stores**: global reactive state shared across contexts
- **Tags**: independent instances of the same context (`hctx="counter#first"`, `hctx="counter#second"`)
- **Local actions**: `$`-prefixed actions scoped to a single fragment
- **Middleware**: intercept and conditionally block actions/effects
- **Async**: async actions/effects with automatic concurrent execution prevention
- **Cross-context**: listen to actions from other contexts via `@`
- **Auto-import**: context modules loaded dynamically when first encountered
- **Cleanup**: `onCleanup` callbacks for resource management, auto-called on element removal
- **Re-execution**: actions can re-trigger themselves with delay and iteration control

## Installation

```bash
npm install hctx
```

**CDN (no build step):**

```html
<script src="https://unpkg.com/hctx" defer></script>
```

## Quick Start

### Browser (IIFE)

```html
<script src="https://unpkg.com/hctx" defer></script>
<script>
  document.addEventListener('hc:loaded', () => {
    hctx.newCtx("counter", () => ({
      data: { count: 0 },
      actions: {
        increment: ({ data }) => { data.count++; }
      },
      effects: {
        render: {
          handle: ({ data, el }) => { el.textContent = data.count; },
          subscribe: ({ add, data }) => { add(data, "count"); }
        }
      }
    }));
    hctx.start();
  });
</script>

<div hctx="counter">
  <h3 hc-effect="render on hc:statechanged">0</h3>
  <button hc-action="increment on click">+1</button>
</div>
```

### ESM (TypeScript)

```ts
// counter.ctx.ts
import { defineContext } from "hctx";

export default defineContext(() => ({
  data: { count: 0 },
  actions: {
    increment: ({ data }) => { data.count++; }
  },
  effects: {
    render: {
      handle: ({ data, el }) => { el.textContent = data.count; },
      subscribe: ({ add, data }) => { add(data, "count"); }
    }
  }
}));
```

```ts
// main.ts
import { start } from "hctx";

start({
  getImportCallback: (name) => () => import(`./contexts/${name}.ctx.ts`)
});
```

## Documentation

- [capabilities.md](docs/capabilities.md): full feature reference
- [reactivity.md](docs/reactivity.md): deep dive into the two-tier reactivity system

## License

MIT
