import { start } from "hctx";

// Auto-import: contexts are loaded by name from src/contexts/*.ctx.ts
// When hctx encounters <div hctx="counter">, it calls getImportCallback("counter")
// which returns a dynamic import for ./contexts/counter.ctx.ts
start({
  getImportCallback: (ctxName) => () =>
    import(`./contexts/${ctxName}.ctx.ts`),
});
