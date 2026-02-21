# hctx - Reactivity System

hctx has two distinct subscription mechanisms that work together to connect actions (state mutations) to effects (DOM updates). Understanding both is key to understanding how reactivity flows through the framework.

---

## Table of Contents

1. [Overview](#overview)
2. [State Subscribers (proxy-based reactivity)](#state-subscribers-proxy-based-reactivity)
3. [Action Subscribers (callback-based pub/sub)](#action-subscribers-callback-based-pubsub)
4. [Comparison](#comparison)
5. [How They Work Together](#how-they-work-together)

---

## Overview

| | State Subscribers | Action Subscribers |
|---|---|---|
| **Trigger syntax** | `hc:statechanged` | `a:actionName` |
| **Mechanism** | Proxy-based change detection | Callback-based pub/sub |
| **Fires when** | A subscribed property is written to | An action completes (or is about to start) |
| **Granularity** | Per-property or per-object | Per-action |
| **Requires `subscribe` function?** | Yes | No |

State subscribers are **data-driven**: "this value changed."
Action subscribers are **event-driven**: "this action happened."

A state subscription on a property fires only when that specific property is written to, regardless of which action caused it. An action could modify 10 properties but its action subscribers fire only once.

---

## State Subscribers (proxy-based reactivity)

hctx watches subscribed objects for property writes and automatically fires callbacks when changes occur. Effects declare which properties they care about, and the framework handles the rest.

### HTML

```html
<div hctx="counter">
  <span hc-effect="render on hc:statechanged"></span>
  <button hc-action="increment on click">+1</button>
</div>
```

### Context definition

```js
hctx.newCtx("counter", () => ({
  data: {
    counter: { count: 0 }
  },
  actions: {
    increment: ({ data }) => { data.counter.count++; }
  },
  effects: {
    render: {
      handle: ({ data, el }) => {
        el.textContent = data.counter.count;
      },
      subscribe: ({ add, data }) => {
        add(data.counter, "count");
      }
    }
  }
}));
```

The `subscribe` function is the key: it tells hctx exactly which properties to watch.

### Defining subscriptions

The `subscribe` callback receives `{ add, data, useStore }`:

- **`add(object, property)`**: watch a specific property on an object. The effect fires only when that property is written to.
- **`add(object)`**: watch all properties on an object. The effect fires when any property changes.

Subscriptions activate after `start()` completes. State subscriptions are global across all fragments of a context, since all fragments share the same `data` object.

### Property-level vs object-level subscriptions

```js
// Property-level - fires ONLY when data.counter.count changes
subscribe: ({ add, data }) => {
  add(data.counter, "count");
}
```

```js
// Object-level - fires when ANY property of data.counter changes
subscribe: ({ add, data }) => {
  add(data.counter);
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

When a subscribed property is written, the effect receives `details.trigger` in the format `hc:statechanged:propertyName`. The `details.initTrigger` stays as `hc:statechanged`.

The subscription (`add()`) controls **whether** the effect fires. The named trigger tells you **why** it fired. This is useful when an effect subscribes to multiple properties and needs to branch:

```js
effects: {
  update: {
    handle: ({ data, el, details }) => {
      if (details.trigger === "hc:statechanged:name") {
        el.querySelector(".name").textContent = data.user.name;
      }
      if (details.trigger === "hc:statechanged:email") {
        el.querySelector(".email").textContent = data.user.email;
      }
    },
    subscribe: ({ add, data }) => {
      add(data.user, "name");
      add(data.user, "email");
    }
  }
}
```

Object-level subscriptions (`add(obj)` with no property) also receive named triggers. `details.trigger` reflects the actual property that was written.

Note: `hc:statechanged:propertyName` is runtime metadata only. It cannot be used as an HTML attribute trigger, the attribute must be `hc:statechanged`.

### Store subscriptions

Stores participate in the same reactivity system:

```js
subscribe: ({ add, useStore }) => {
  const store = useStore(myStore);
  add(store, "theme");
}
```

`useStore` inside `subscribe` returns the store object so `add()` can set up tracking on it.

---

## Action Subscribers (callback-based pub/sub)

This is a classic event emitter pattern. An effect registers interest in a named action, and when that action runs, the effect fires.

### HTML

```html
<div hctx="counter">
  <span hc-effect="render on a:increment"></span>
  <button hc-action="increment on click">+1</button>
</div>
```

No `subscribe` function needed on the effect: it simply listens for the action by name.

### Phases

Action subscribers support two phases:

- `a:increment:before`: fires after middleware passes, right before the handler runs
- `a:increment:after` (or just `a:increment`): fires after the handler completes

### Scope

There are two levels of action subscriber dispatch:

- **Context-level**: All effects listening to actions within the context, across all fragments.
- **Fragment-level**: Effects listening to `$`-prefixed local actions within a specific DOM fragment.

When a local action (`$increment`) fires, only effects in the same fragment are notified. See [Local Actions](capabilities.md#10-local-actions--prefix) for details.

---

## Comparison

| | State Subscribers | Action Subscribers |
|---|---|---|
| **When to use** | React to data changes, regardless of which action caused them | React to a specific action happening |
| **HTML trigger** | `hc:statechanged` | `a:actionName` |
| **JS requirement** | `subscribe` function with `add()` calls | None beyond the action existing |
| **Fires per action run** | Once per changed subscribed property | Once (before and/or after) |
| **Supports phases** | No (fires on write) | Yes (`a:action:before`, `a:action:after`) |
| **Cross-context** | No (tracks objects directly) | Yes (`a:action@otherCtx`) |
| **Multiple sources** | Multiple properties across data and stores | One action name per subscription |

---

## How They Work Together

A typical context uses both mechanisms:

```html
<div hctx="todo">
  <input hc-action="setInput on input" />
  <button hc-action="addTodo on click">Add</button>
  <ul hc-effect="renderList on hc:statechanged"></ul>
  <span hc-effect="showAdded on a:addTodo">Added!</span>
</div>
```

```js
hctx.newCtx("todo", () => ({
  data: {
    input: "",
    items: []
  },
  actions: {
    setInput: ({ data, event }) => {
      data.input = event.target.value;
    },
    addTodo: ({ data }) => {
      data.items = [...data.items, data.input];
      data.input = "";
    }
  },
  effects: {
    // State subscriber - re-renders when items array changes
    renderList: {
      handle: ({ data, el }) => {
        el.innerHTML = data.items.map(i => `<li>${i}</li>`).join("");
      },
      subscribe: ({ add, data }) => {
        add(data, "items");
      }
    },
    // Action subscriber - shows feedback when addTodo runs
    showAdded: ({ el }) => {
      el.style.opacity = "1";
      setTimeout(() => { el.style.opacity = "0"; }, 1000);
    }
  }
}));
```

- `renderList` uses **state subscribers**: it doesn't care which action changed `items`, it just re-renders when `items` is written to. Both `addTodo` and any future action that modifies `items` will trigger it.
- `showAdded` uses **action subscribers**: it fires specifically when `addTodo` completes, regardless of what data changed. It shows a brief "Added!" notification.
- `setInput` modifies `data.input` but `renderList` doesn't subscribe to `"input"`, so it doesn't re-render on every keystroke, only when `"items"` changes.
