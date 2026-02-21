import { defineContext, newStore, newMid } from "hctx";

// Shared store: accessible from any context via useStore
const themeStore = newStore(() => ({
  mode: "light" as "light" | "dark",
}));

// Middleware: logs every action/effect in this context
const logger = newMid(({ type, details }) => {
  console.log(`[dashboard] ${type}: ${details.trigger}`);
});

type Data = {
  lastAction: string;
};

export default defineContext<Data>(() => ({
  data: { lastAction: "" },

  // Context-level middleware applies to all actions and effects
  options: { middleware: [logger] },

  actions: {
    toggleTheme: ({ data, useStore }) => {
      const store = useStore(themeStore);
      store.mode = store.mode === "light" ? "dark" : "light";
      data.lastAction = "toggleTheme → " + store.mode;
    },
  },

  effects: {
    renderTheme: {
      handle: ({ el, useStore }) => {
        const store = useStore(themeStore);
        el.textContent = store.mode;
      },
      // Store subscription: re-renders when themeStore.mode changes
      subscribe: ({ add, useStore }) => {
        const store = useStore(themeStore);
        add(store, "mode");
      },
    },
    renderLog: {
      handle: ({ data, el }) => {
        el.textContent = data.lastAction;
      },
    },
  },
}));
