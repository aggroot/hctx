# hctx Examples

Runnable examples that demonstrate hctx capabilities progressively.

## Quick Start

Build the library first (required for all examples):

```bash
cd ..
pnpm run build
```

### JavaScript (IIFE) — no bundler needed

Open any `.html` file directly in a browser:

```
01-counter.html      — Core basics: contexts, actions, effects, subscriptions
02-todo-list.html    — Reactivity, DSL combinators, write traps
03-composition.html  — Fragments, tags, local actions, cross-context, phases
04-advanced.html     — Async, middleware, stores, execute, cleanup, props, dynamic
```

### TypeScript (ESM) — Vite project

```bash
cd esm
pnpm install
pnpm run dev
```

Demonstrates `defineContext`, typed data, auto-import, and stores in a module-based setup.

## Learning Path

1. **01-counter** — Understand the action/effect pipeline and state subscriptions
2. **02-todo-list** — Learn the attribute DSL and fine-grained reactivity
3. **03-composition** — Master multi-location contexts, scoping, and cross-context communication
4. **04-advanced** — Explore the full toolkit: async, middleware, stores, re-execution, cleanup
5. **esm/** — See how hctx works as an ES module with TypeScript and Vite
