/*---------------------------------------------------------------------------------------------
*  Copyright (c) The hctx Contributors
*  
*  All rights reserved to copyright holders.
*  
*  See the AUTHORS file for a full list of contributors.
*  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import {
  ActionDefinition,
  ActionOptions,
  HContext,
  HContextCallback,
  HContextOptions,
  EffectDefinition,
  EffectOptions,
  ContextDetails,
  MiddlewareCallback,
  MiddlewareContext,
  Options,
  Phase,
  Store,
  ImportCallback,
  CleanupCallback,
  OnCleanup,
} from "./types";

import { dispatch, isObject, merge } from "../helpers";

let ctxAttr: string;
let ctxSelector: string;
let actionAttr: string;
let effectAttr: string;
let actionOrEffectSelector: string;
let isDev: boolean;

let started = false;

export const load = () => {
  type WindowType = Window & typeof globalThis & { hctx: typeof hctx };
  (window as WindowType).hctx = hctx;
  dispatch(document, "hc:loaded");
};

let startReady = false;
let getImportPath: Options["getImportPath"] | undefined;
let getImportCallback: Options["getImportCallback"] | undefined;

export const start = async (o?: Options, emit = true) => {
  started = true;
  actionAttr = o?.actionAttr ?? "hc-action";
  effectAttr = o?.effectAttr ?? "hc-effect";
  isDev = o?.isDev ?? false
  ctxAttr = o?.ctxAttr ?? "hctx";
  actionOrEffectSelector = `[${actionAttr}],[${effectAttr}]`;
  ctxSelector = `[${ctxAttr}]`;
  getImportPath = o?.getImportPath;
  getImportCallback = o?.getImportCallback;

  const ctxElements = document.querySelectorAll(
    ctxSelector
  ) as NodeListOf<HTMLElement>;

  await importUnregisteredContexts(Array.from(ctxElements));

  const skipCtx = new Set<Element>();
  for (let i = 0; i < ctxElements.length; i++) {
    const ctxElement = ctxElements[i];
    handleCtx(ctxElement, skipCtx);
  }
  patchStateSubs();
  patchGlobalSubs();
  startReady = true;
  runInitRunners();
  startMutationObserver();
  dispatch(document, "hc:started");

};

type ContextCallbacks<D extends object> = {
  [key: string]: HContextCallback<D>;
};

const ctxCallbacks: ContextCallbacks<object> = {};

export const newCtx = <D extends object>(
  name: string,
  callback: HContextCallback<D>
) => {
  if (!ctxCallbacks[name]) {
    ctxCallbacks[name] = callback;
  }
};

export const defineContext = <D extends object>(handle: HContextCallback<D>) => handle;

export const newStore = <T extends object>(handle: () => T): Store<T> => {
  return { uid: crypto.randomUUID(), handle };
};

export const newMid = (handle: MiddlewareCallback): MiddlewareCallback => {
  return handle;
};

export const hctx = {
  newCtx,
  newMid,
  newStore,
  start,
  load,
  defineContext
};

const importUnregisteredContexts = async (ctxElements: HTMLElement[]) => {


  if (getImportPath || getImportCallback) {
    const contexts: string[] = [];
    ctxElements.forEach((el) => {
      const ctx = el.getAttribute(ctxAttr)!.trim().split("#")[0];

      if (!ctxCallbacks[ctx] && !contexts.includes(ctx)) contexts.push(ctx);
    });

    const imports = contexts.map(async (ctxName) => {
      const importCallback = getImportCallback
        ? getImportCallback(ctxName)
        : ((() =>
          getImportPath &&
          import(
              /* @vite-ignore */ getImportPath(ctxName)
          )) as ImportCallback);

      try {
        const contextCallback = (await importCallback()).default;

        newCtx(ctxName!, contextCallback);
      } catch (error) {
        isDev && console.error(
          `Failed to import context "${ctxName}" using ${importCallback}`,
          error
        );
      }
    });
    await Promise.allSettled(imports);
  }
};

function mergeOptions(
  co?: HContextOptions,
  ao?: HContext<object>["actions"]["options"],
  options?: object
): HContextOptions & ActionOptions;
function mergeOptions(
  co?: HContextOptions,
  ao?: HContext<any>["effects"]["options"],
  options?: object
): HContextOptions & EffectOptions;
function mergeOptions(o1?: object, o2?: object, options?: object) {
  if (!o1) o1 = {};
  if (!o2) o2 = {};
  return merge(o1, o2, options);
}

type InternalContext = HContext<object & { __pCheck?: boolean }> & {
  dataWithTrap: object;
  name: string;
  tag?: string;
  actionOptions: ActionOptions;
  effectOptions: EffectOptions;
  processedEffects: ProcessedEffects;
  processedActions: ProcessedActions;
  actionSubscribers: ActionSubscribers;
  fragments: Map<number, ContextFragment>;
};

type ActionSubscribers = {
  [key: string]: Set<CallbackEvent>;
};

const newContext = (ctxName: string): InternalContext => {

  const ctx = ctxCallbacks[ctxName]();
  const newCtx: InternalContext = {
    ...ctx,
    name: ctxName,
    actionOptions: mergeOptions(ctx.options, ctx.actions.options, {
      clone: true,
    }),
    effectOptions: mergeOptions(ctx.options, ctx.effects.options, {
      clone: true,
    }),
    processedEffects: {},
    processedActions: {},
    actionSubscribers: {},
    dataWithTrap: new Proxy(ctx.data, writeTrap("data")),
    fragments: new Map<number, ContextFragment>(),
  };

  return newCtx;
};

const ctxMap = new Map<string, InternalContext>();
const getContext = (ctxAttr: string): InternalContext => {
  let ctx = ctxMap.get(ctxAttr);
  if (!ctx) {
    const [name, tag] = ctxAttr.split("#");
    ctx = newContext(name);
    ctx.name = ctxAttr;
    ctx.tag = tag ?? undefined;
    ctxMap.set(ctxAttr, ctx);
  }
  return ctx;
};

type CallbackEvent = (event?: Event, details?: Partial<ContextDetails>) => void;

const initRunners: CallbackEvent[] = [];

const runInitRunners = () => {
  for (const handle of initRunners) {
    handle();
  }
  initRunners.length = 0;
};

const patchStateSubs = () => {
  for (const ctx of ctxMap) {
    const context = ctx[1];
    if (context.data.__pCheck === true) {
      context.data.__pCheck = false;
      context.data = patchProxies(context.data);
    }
  }

  for (const s of storeMap) {
    const store = s[1];
    if (store.store.__pCheck === true) {
      store.store.__pCheck = false;
      store.store = patchProxies(store.store);
    }
  }
};

type ProxyObject = object & {
  __proxy?: object;
  __pEvents?: Record<string, Set<CallbackEvent>>;
}

function patchProxies(obj: any): object {
  for (let key in obj) {
    if (
      obj.hasOwnProperty(key) &&
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      key !== "__proxy"
    ) {
      obj[key] = patchProxies(obj[key]);
    }
  }
  if (obj.__proxy) {
    const proxy = obj.__proxy
    obj.__proxy = "patched"
    obj = proxy;
  }
  return obj;
}

type ContextFragment = {
  processedActions: ProcessedActions;
  actionSubscribers: ActionSubscribers;
};

type ContextElement = HTMLElement & {
  _hc_meta?: {
    _hc_ctx: string;
    _hc_ctxId: number;
    _hc_runningAsync: Record<string, Set<Element>>;
  };
};

let idCount = 0;

function handleCtx(
  ctxElement: ContextElement,
  skipCtx: Set<Element>,
  banned?: Set<Element>,
  isMutation?: boolean
) {
  if (skipCtx.has(ctxElement)) return;
  skipCtx.add(ctxElement);

  const ctxName = ctxElement.getAttribute(ctxAttr);
  const ctx = getContext(ctxName!);

  if (!banned) {
    banned = new Set();
  }

  const nestedCtxElements = ctxElement.querySelectorAll(
    ctxSelector
  ) as NodeListOf<HTMLElement>;

  if (nestedCtxElements.length > 0) {
    for (let i = 0; i < nestedCtxElements.length; i++) {
      const nestedCtx = nestedCtxElements[i];
      handleCtx(nestedCtx, skipCtx, banned, isMutation);
    }
  }

  const ctxChildElementList: HTMLElement[] = Array.from(
    ctxElement.querySelectorAll(actionOrEffectSelector)
  );



  ctxChildElementList.unshift(ctxElement);
  const runningAsync: Record<string, Set<Element>> = {};

  const localActionSubscribers: ActionSubscribers = {};
  const localProcessedActions: ProcessedActions = {};

  const ctxId = ++idCount;

  ctx.fragments.set(ctxId, {
    processedActions: localProcessedActions,
    actionSubscribers: localActionSubscribers,
  });

  ctxElement._hc_meta = {
    _hc_ctx: ctx.name,
    _hc_ctxId: ctxId,
    _hc_runningAsync: runningAsync,
  };

  for (let j = 0; j < ctxChildElementList.length; j++) {
    const ctxChildElement = ctxChildElementList[j];

    if (banned.has(ctxChildElement) || (ctxName !== ctxChildElement.getAttribute(ctxAttr)
      && skipCtx.has(ctxChildElement))) continue;
    banned.add(ctxChildElement);

    handleCtxChild(
      ctx,
      ctxChildElement,
      runningAsync,
      localProcessedActions,
      localActionSubscribers,
      isMutation
    );
  }
}

type ContextChildElement = HTMLElement & {
  _hc_cleanups?: CleanupCallback[];
};





type GetCallback = (trigger: string, runPhase?: Phase) => CallbackEvent

const handleCtxChild = (
  ctx: InternalContext,
  ctxChildElement: ContextChildElement,
  runningAsync: Record<string, Set<Element>>,
  localProcessedActions: ProcessedActions,
  localActionSubscribers: ActionSubscribers,
  isMutation?: boolean
) => {
  const cleanupCallbacks: CleanupCallback[] = [];
  const globalProcessedActions = ctx.processedActions;
  const processedEffects = ctx.processedEffects;
  const actionSubscribers = ctx.actionSubscribers;

  ctxChildElement._hc_cleanups = cleanupCallbacks;

  const onCleanup: OnCleanup = (handle) => {
    cleanupCallbacks.push(handle);
  };

  const processTriggers = (
    aoeWithTriggers: ReturnType<typeof parseCtxChildAttribute>,
    aoe: string,
    proccesedAoE: ProcessedAction | ProcessedEffect,
    isAction: boolean,
    getCallbackEvent: GetCallback
  ) => {

    for (const trigger of aoeWithTriggers[aoe]) {
      if (trigger.toLowerCase() === "hc:statechanged") {
        if (proccesedAoE.subscribe) {
          const { args, subEventsDto } = getSubsArgs(ctx)
          proccesedAoE.subscribe(args);
          const handle = getCallbackEvent(trigger)
          if (subEventsDto.length > 0) {
            for (const se of subEventsDto) {
              se.add(handle)
              onCleanup(async () => {
                se.delete(handle)
                
              })
            }
          }
        }
      } else if (trigger === "hc:loaded" && !isMutation) {
        initRunners.push(getCallbackEvent(trigger));
      } else if (trigger === "hc:mutated" && isMutation) {
        initRunners.push(getCallbackEvent(trigger));
      } else if (trigger.startsWith("a:")) {
        if (
          isAction &&
          Object.keys(aoeWithTriggers).includes(trigger.split(":")[1])
        ) {
          throw Error(
            `circular action detected for element ${ctxChildElement.outerHTML}`
          );
        }
        const actionTrigger = validateAction(trigger, ctx, true);
        const actionTriggerName = actionTrigger.name;
        const runPhase = actionTrigger.phase;
        const externalCtx = actionTrigger.extCtx;
        if (externalCtx) {
          const callback = getCallbackEvent(
            `hc:action:${actionTriggerName}@${actionTrigger.extCtx}`,
            runPhase
          );
          subscribe(getGlobalSubs(externalCtx), actionTriggerName, callback);
          onCleanup(async () => {
            ctxMap
              .get(externalCtx)
              ?.actionSubscribers[actionTriggerName].delete(callback)
          }
          );
        } else {
          const callback = getCallbackEvent(
            `hc:action:${actionTriggerName}@${ctx.name}`,
            runPhase
          );
          subscribe(actionSubscribers, actionTriggerName, callback);
          subscribe(localActionSubscribers, actionTriggerName, callback);
          onCleanup(async () => {
            actionSubscribers[actionTriggerName].delete(callback);
            localActionSubscribers[actionTriggerName].delete(callback);
          });
        }
      } else {
        const handle = getCallbackEvent(trigger);
        ctxChildElement.addEventListener(trigger, handle);
        onCleanup(async () => {
          ctxChildElement.removeEventListener(trigger, handle)
        });
      }
    }
  };

  if (isActionElement(ctxChildElement)) {
    const actAttr = ctxChildElement.getAttribute(actionAttr);
    const actionsWithTriggers = parseCtxChildAttribute(actAttr!);

    for (const action in actionsWithTriggers) {
      let isLocal = action.startsWith("$");
      let processedActions = isLocal
        ? localProcessedActions
        : globalProcessedActions;
      const actionKey = isLocal ? action.split("$")[1] : action;
      let processedAction: ProcessedAction = processedActions[actionKey];

      if (!processedAction) {
        const ctxAction: Action = merge(
          ctx.actionOptions,
          validateAction(action, ctx),
          { clone: true }
        );
        const { hasAsync, processedMiddleware } = processMiddleware(
          ctxAction.middleware
        );

        processedAction = {
          ...ctxAction,
          hasAsyncMid: hasAsync,
          middleware: processedMiddleware,
          ctxName: ctx.name,
        };
        processedActions[actionKey] = processedAction;
      }
      const actionName = processedAction.name;
      const getActionCallback = (trigger: string, runPhase?: Phase): CallbackEvent =>
        (event?: Event, details?: Partial<ContextDetails>) => {
          if (!startReady) return;
          const defaultDetails: ContextDetails = {
            contextTag: ctx.tag,
            phase: "after",
            trigger,
            initTrigger: trigger,
            isLocal,
          };
          const finalDetails = details
            ? { ...defaultDetails, ...details }
            : defaultDetails;
          if (finalDetails.phase !== (runPhase ?? "after")) return;
          hctxAction(
            processedAction,
            ctxChildElement,
            ctx,
            isLocal
              ? localActionSubscribers[actionName]
              : actionSubscribers[actionName],
            finalDetails,
            runningAsync,
            onCleanup,
            event
          );
        };

      processTriggers(
        actionsWithTriggers,
        action,
        processedAction,
        true,
        getActionCallback
      );

    }
  }

  if (isEffectElement(ctxChildElement)) {
    const effAttr = ctxChildElement.getAttribute(effectAttr);
    const effectWithTriggers = parseCtxChildAttribute(effAttr!);
    for (const effect in effectWithTriggers) {
      let processedEffect: ProcessedEffect = processedEffects[effect];
      if (!processedEffect) {
        let validatedEffect = validateEffect(effect, ctx);
        validatedEffect = merge(ctx.effectOptions, validatedEffect, {
          clone: true,
        });

        const { hasAsync, processedMiddleware } = processMiddleware(
          validatedEffect.middleware
        );
        processedEffect = {
          ...validatedEffect,
          hasAsyncMid: hasAsync,
          middleware: processedMiddleware,
          ctxName: ctx.name,
        };
        processedEffects[effect] = processedEffect;
      }

      const getEffectCallback = (trigger: string, runPhase?: Phase): CallbackEvent =>
        (event?: Event, details?: Partial<ContextDetails>) => {
          if (!startReady) return;
          const defaultDetails: ContextDetails = {
            phase: "after",
            trigger,
            initTrigger: trigger,
            contextTag: ctx.tag,
          };
          const finalDetails = details
            ? { ...defaultDetails, ...details }
            : defaultDetails;
          if (finalDetails.phase !== (runPhase ?? "after")) return;
          hctxEffect(
            processedEffect,
            ctxChildElement,
            ctx,
            finalDetails,
            runningAsync,
            onCleanup,
            event

          );
        };

      processTriggers(
        effectWithTriggers,
        effect,
        processedEffect,
        false,
        getEffectCallback
      );
    }
  }
};

const getSubsArgs = (
  ctx: InternalContext,
) => {
  const { add, subEventsDto } = getAddCallback()
  const args = new Proxy(
    {
      data: ctx.data,
      useStore: getUseStoreCallback(false, true),
      add
    },
    {
      get: function (t, p, r) {
        if (p === "data") {
          if (t["data"].__pCheck === undefined) {
            Object.defineProperty(t["data"], "__pCheck", {
              value: true,
              writable: true,
            });
          }
        }
        return Reflect.get(t, p, r);
      },
    }
  );
  return { args, subEventsDto }
}

const getAddCallback = () => {
  const subEventsDto: Set<CallbackEvent>[] = []
  const add = (
    object: ProxyObject,
    property?: string | number | symbol
  ) => {
    let events = object.__pEvents;
    if (!events) {
      events = {};
      Object.defineProperty(object, "__pEvents", {
        value: events,
        writable: false,
      });
    }

    if (property && !object.hasOwnProperty(property)) {
      isDev && console.error(`No property ${property.toString()} on object ${object}`)
    } else {
      const key = property?.toString() ?? "all";
      let thisEvents = events[key];
      if (!thisEvents) {
        thisEvents = new Set();
        events[key] = thisEvents;
      }
      subEventsDto.push(thisEvents)
    }

    if (!object.__proxy) {
      const proxy = new Proxy(object, {
        set(
          target,
          prop: string | symbol,
          value: any,
          receiver: any
        ): boolean {
          const events = target.__pEvents
          const propCallbacks = events ? events[prop.toString()] : undefined;
          Reflect.set(target, prop, value, receiver);
          if (propCallbacks) {
            for (const cbEvent of propCallbacks) {
              cbEvent(undefined, { trigger: `hc:statechanged:${prop.toString()}` });
            }
          }
          const allProps = events ? events["all"] : undefined;
          if (allProps) {
            for (const cbEvent of allProps) {
              cbEvent(undefined, { trigger: `hc:statechanged:${prop.toString()}` });
            }
          }
          return true
        },
      });
      Object.defineProperty(object, "__proxy", {
        value: proxy,
        writable: true,
      });
    }
  };

  return { add, subEventsDto }
};

const execSubsCallback = (
  subscribe: Set<CallbackEvent>,
  details?: Partial<ContextDetails>
) => {
  if (subscribe) {
    for (const handle of subscribe) {
      handle(undefined, details);
    }
  }
};

const getActionCallback =
  (
    action: ProcessedAction,
    el: ContextChildElement,
    ctx: InternalContext,
    subscribe: Set<CallbackEvent>,
    details: ContextDetails,
    runningAsync: Record<string, Set<Element>>,
    onCleanup: OnCleanup,
    event?: Event,
    counter = 0
  ) =>
    (
      reason = "execute",
      delay = 200,
      callback = (counter: number) => { },
      times: number
    ) => {
      setTimeout(() => {
        counter++;
        callback(counter);
        if (!times || counter <= times) {
          hctxAction(
            action,
            el,
            ctx,
            subscribe,
            { ...details, trigger: reason },
            runningAsync,
            onCleanup,
            event,
            counter
          );
        }
      }, delay && delay > 0 ? delay : 0);
    };

const hctxAction = (
  action: ProcessedAction,
  el: ContextChildElement,
  ctx: InternalContext,
  subscribe: Set<CallbackEvent>,
  details: ContextDetails,
  runningAsync: Record<string, Set<Element>>,
  onCleanup: OnCleanup,
  event?: Event,
  counter = 0
) => {
  let thisAsync = runningAsync[action.name];
  if (!thisAsync) {
    thisAsync = new Set<Element>();
    runningAsync[action.name] = thisAsync;
  }
  if (thisAsync.has(el)) return;
  const execute = getActionCallback(
    action,
    el,
    ctx,
    subscribe,
    details,
    runningAsync,
    onCleanup,
    event,
    counter
  );
  let handle = action.handle;
  const data = ctx.data;
  const middleware = action.middleware;
  const aCtx = {
    data,
    el: (action.useRawElement ? el : el.cloneNode(true)) as HTMLElement,
    execute,
    useStore: getUseStoreCallback(),
    onCleanup,
    details,
    ctxTag: ctx.tag,
    event,
  };

  const nextDetails: Partial<ContextDetails> = {
    phase: "after",
    isLocal: action.isLocal,
    initTrigger: details.initTrigger,
  };
  if (isAsync(handle) || action.hasAsyncMid) {
    thisAsync.add(el);
    execMiddlewareWithAsync(el, details, "action", middleware)
      .then((success) => {
        if (success === false) {
          return Promise.reject("Middleware execution failed");
        } else {
          execSubsCallback(subscribe, { ...nextDetails, phase: "before" });
        }
        return handle(aCtx, action.props);
      })
      .then(() => {
        thisAsync.delete(el);
        execSubsCallback(subscribe, nextDetails);
      });
  } else {
    const success = execMiddleware(el, details, "action", middleware);
    if (success === false) return;
    execSubsCallback(subscribe, { ...nextDetails, phase: "before" });
    handle(aCtx, action.props);
    execSubsCallback(subscribe, nextDetails);
  }
};

const wait = (ms = 1000) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
};

const writeTrap = (name: string) => ({
  set: function () {
    throw Error(
      `${name} writes not allowed within effects by default. use allowStateMutations option to activate it.`
    );
  },
});

const getUseStoreCallback =
  (isTrap = false, isSetProxy = false) =>
    (store: Store): any => {
      let returnStore = storeMap.get(store.uid);
      if (!returnStore) {
        let storeResult = store.handle();
        returnStore = {
          store: storeResult,
          setTrap: new Proxy(storeResult, writeTrap("store")),
        };
        storeMap.set(store.uid, returnStore);
      }
      if (isSetProxy) {
        if (returnStore.store.__pCheck === undefined) {
          Object.defineProperty(returnStore.store, "__pCheck", {
            value: true,
            writable: true,
          });
        }

      }
      if (isTrap) {
        return returnStore.setTrap;
      } else {
        return returnStore.store;
      }
    };

const hctxEffect = (
  effect: ProcessedEffect,
  el: ContextChildElement,
  ctx: InternalContext,
  details: ContextDetails,
  runningAsync: Record<string, Set<Element>>,
  onCleanup: OnCleanup,
  event?: Event

) => {
  let thisAsync = runningAsync[effect.name];
  if (!thisAsync) {
    thisAsync = new Set<Element>();
    runningAsync[effect.name] = thisAsync;
  }
  if (thisAsync.has(el)) return;
  let handle = effect.handle;

  const data =
    ctx.effectOptions.allowStateMutations || effect.allowStateMutations ? ctx.data : ctx.dataWithTrap;
  const middleware = effect.middleware;

  const eCtx = {
    data,
    el,
    details,
    useStore: getUseStoreCallback(!(ctx.effectOptions.allowStateMutations || effect.allowStateMutations)),
    onCleanup,
    event,
  };
  if (isAsync(handle) || effect.hasAsyncMid) {
    thisAsync.add(el);
    execMiddlewareWithAsync(el, details, "effect", middleware)
      .then((success) => {
        if (success === false) {
          return Promise.reject("Middleware execution failed");
        }
        return handle(eCtx, effect.props);
      })
      .then(() => {
        thisAsync.delete(el);
      });
  } else {
    const success = execMiddleware(el, details, "effect", middleware);
    if (success === false) return;
    handle(eCtx, effect.props);
  }
};

type ProcessedActions = {
  [k: string]: ProcessedAction;
};

type ProcessedAction = Omit<Action, "middleware" | "stores"> & {
  hasAsyncMid?: boolean;
  middleware?: MiddlewareCallback[];
  ctxName: string;
};

type Action = ReturnType<typeof validateAction>;

export const validateAction = (
  actionName: string,
  ctx: InternalContext,
  asTrigger = false
) => {
  let extCtx: string | undefined = undefined;
  let embededCtxName: string;
  let isLocal = false;
  let props = undefined;
  let phase: Phase | undefined = undefined;
  if (asTrigger) {
    actionName = actionName.replace("a:", "");
    let partPhase = undefined;
    [actionName, partPhase] = actionName.split(":");
    if (partPhase && (partPhase === "before" || partPhase === "after")) {
      phase = partPhase;
    }
  } else {
    if (actionName.startsWith("$")) {
      isLocal = true;
      actionName = actionName.replace("$", "");
    }
    const index = actionName.indexOf(":") + 1;
    const rawProps =
      index > 0 ? actionName.substring(index, actionName.length) : undefined;
    props = rawProps ? JSON.parse(rawProps) : {};
    props = isObject(props) ? props : {};
    actionName = actionName.split(":", 1)[0];
  }

  [actionName, embededCtxName] = actionName.split("@");
  let [nonTagName, tag] = actionName.split("#");

  if (embededCtxName) {
    extCtx = embededCtxName;
    [embededCtxName] = embededCtxName.split("#");
    if (ctxMap.has(embededCtxName)) {
      ctx = ctxMap.get(embededCtxName)!;
    } else {
      throw Error(`No such context ${embededCtxName}`);
    }
  }

  let action = (ctx.actions as ActionDefinition<any>)[nonTagName];
  if (!action) {
    throw Error(`${nonTagName} action doesn't exist for context ${ctx.name}`);
  }
  if (!("handle" in action)) action = { handle: action };
  return { ...action, name: actionName, isLocal, extCtx, tag, props, phase };
};

type ProcessedEffects = {
  [k: string]: ProcessedEffect;
};

type ProcessedEffect = Omit<Effect, "middleware" | "stores"> & {
  middleware?: MiddlewareCallback[];
  hasAsyncMid: boolean;
  ctxName: string;
};

type Effect = ReturnType<typeof validateEffect>;

export const validateEffect = (effectName: string, ctx: InternalContext) => {
  const index = effectName.indexOf(":") + 1;
  const rawProps =
    index > 0 ? effectName.substring(index, effectName.length) : undefined;
  let props = rawProps ? JSON.parse(rawProps) : {};
  props = isObject(props) ? props : {};
  effectName = effectName.split(":", 1)[0];
  let effect = (ctx.effects as EffectDefinition<any>)[effectName];
  if (!effect) {
    throw Error(`${effectName} effect doesn't exist for context ${ctx.name}`);
  }
  if (!("handle" in effect)) effect = { handle: effect };
  return { ...effect, name: effectName, props };
};

type MiddlewareArray = Action["middleware"] & Effect["middleware"];

const processMiddleware = (arr: MiddlewareArray) => {
  let processedMiddleware: MiddlewareCallback[] = [];
  let hasAsync = false;
  if (arr) {
    for (let i = 0; i < arr.length; i++) {
      let middleware = arr[i];
      if (typeof middleware !== "function") {
        throw Error(
          "middleware function or created with hc.newMid(callback) function"
        );
      }
      if (isAsync(middleware)) hasAsync = true;
      processedMiddleware.push(middleware);
    }
  }
  return { hasAsync, processedMiddleware };
};

type StoreDTO = {
  store: object & { __pCheck?: boolean };
  setTrap: object;
};

const storeMap = new Map<string, StoreDTO>();

const subscribe = (
  actionSubscribers: ActionSubscribers,
  action: string,
  handle: CallbackEvent
) => {
  let sub = actionSubscribers[action];
  if (!sub) {
    sub = new Set();
    actionSubscribers[action] = sub;
  }
  sub.add(handle);
};

const patchGlobalSubs = () => {
  globalSubsMap.forEach((subscribe, ctxName) => {
    const ctxSubs = ctxMap.get(ctxName)!.actionSubscribers;
    for (const action in subscribe) {
      if (ctxSubs[action]) {
        ctxSubs[action] = new Set([...ctxSubs[action], ...subscribe[action]]);
      } else {
        ctxSubs[action] = subscribe[action];
      }
    }
  });
  globalSubsMap.clear();
};

const globalSubsMap = new Map<string, ActionSubscribers>();

const getGlobalSubs = (ctxName: string) => {
  let gSubs = globalSubsMap.get(ctxName);
  if (!gSubs) {
    gSubs = {};
    globalSubsMap.set(ctxName, gSubs);
  }
  return gSubs;
};

function isAsync(fn: any) {
  return fn.constructor.name === "AsyncFunction";
}

const execMiddleware = (
  el: HTMLElement,
  details: MiddlewareContext["details"],
  type: MiddlewareContext["type"],
  middleware?: MiddlewareCallback[]
) => {
  if (middleware) {
    for (let m of middleware) {
      const r = m({ el, details, type });
      if (r === false) return false;
    }
  }
  return true;
};

const execMiddlewareWithAsync = async (
  el: HTMLElement,
  details: MiddlewareContext["details"],
  type: MiddlewareContext["type"],
  middleware?: MiddlewareCallback[]
) => {
  if (middleware) {
    for (let m of middleware) {
      const r = await m({ el, details, type });
      if (r === false) return false;
    }
  }
};

const parseCtxChildAttribute = (attribute: string) => {
  const result: Record<string, Set<string>> = {};
  const pairs = attribute.split(";").map((pair) => pair.trim()).reverse();

  for (const pair of pairs) {
    if (pair.includes(" options ")) continue;
    const [multiActionOrMultiEffect, mutliEventOrMultiAction] = pair
      .split(" on ")
      .map((part) => part.trim());
    const triggers = mutliEventOrMultiAction
      .split(" or ")
      .map((eoa) => eoa.trim());

    const actionsOrEffects = multiActionOrMultiEffect
      .split(" and ")
      .map((aoe) => aoe.trim());

    for (const aoe of actionsOrEffects) {
      if (!result[aoe]) {
        result[aoe] = new Set();
      }
      triggers.map((t) => result[aoe].add(t));
    }
  }
  return result;
};

const isActionElement = (el: Element) => {
  if (el.hasAttribute(actionAttr)) return true;
  return false;
};

const isEffectElement = (el: Element): boolean => {
  if (el.hasAttribute(effectAttr)) return true;
  return false;
};

const startMutationObserver = () => {
  const observer = new MutationObserver(observerCallback);
  observer.observe(document.body, {
    attributes: false,
    childList: true,
    subtree: true,
    characterData: false,
  });
};


const observerCallback: MutationCallback = async (mutationsList) => {
  const banned: Set<Element> = new Set();
  const skipCtx: Set<Element> = new Set();
  for (let mutation of mutationsList) {
    if (mutation.type === "childList") {
      const ctxElements: HTMLElement[] = []
      const actionsAndEffects: HTMLElement[] = []
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i]

        if (node instanceof HTMLElement) {
          const contexts = node.querySelectorAll(ctxSelector);
          const ae = node.querySelectorAll(actionOrEffectSelector);
          for (let i = 0; i < contexts.length; i++) {
            ctxElements.push(contexts[i] as HTMLElement)
          }
          for (let i = 0; i < ae.length; i++) {
            actionsAndEffects.push(ae[i] as HTMLElement)
          }

          if (node.hasAttribute(ctxAttr)) {
            ctxElements.push(node)
          } else if (node.hasAttribute(effectAttr) || node.hasAttribute(actionAttr)) {
            actionsAndEffects.push(node)
          }
        }
      }

      if (ctxElements.length > 0) {
        await importUnregisteredContexts(ctxElements);
        for (let i = 0; i < ctxElements.length; i++) {
          const ctxElement = ctxElements[i];
          handleCtx(ctxElement, skipCtx, banned, true);
        }
      }

      for (const aoe of actionsAndEffects) {
        if (!banned.has(aoe)) {
          const ctxMetadata = getChildContextMetadata(aoe);
          const ctx = ctxMap.get(ctxMetadata.ctxName);
          if (!ctx) throw Error(`unable to find context for element: ${aoe}`);
          const ctxFragment = ctx.fragments.get(ctxMetadata.ctxId) || {
            processedActions: {},
            actionSubscribers: {},
          };
          handleCtxChild(
            ctx,
            aoe,
            {},
            ctxFragment.processedActions,
            ctxFragment.actionSubscribers,
            true
          );
        }
      }



      patchStateSubs();
      patchGlobalSubs();
      runInitRunners();
    }

    mutation.removedNodes.forEach((node: any) => {
      if (node instanceof HTMLElement) {
        removeCtxChildElement(node);
        removeCtxFragment(node as ContextElement);
        const ctxChildElementList = node.querySelectorAll(
          actionOrEffectSelector
        ) as NodeListOf<HTMLElement>;
        for (let i = 0; i < ctxChildElementList.length; i++) {
          removeCtxChildElement(ctxChildElementList[i]);
        }
        // Clean up nested context fragments
        const nestedCtxElements = node.querySelectorAll(ctxSelector);
        for (let i = 0; i < nestedCtxElements.length; i++) {
          removeCtxFragment(nestedCtxElements[i] as ContextElement);
        }
      }
    });
  }
}
  ;

const getChildContextMetadata = (element: ContextElement) => {
  const elName = element.outerHTML;
  while (element) {
    if (element.hasAttribute(ctxAttr)) {
      const meta = element._hc_meta;
      if (meta) {
        return { ctxName: meta._hc_ctx, ctxId: meta._hc_ctxId };
      }
    }
    if (element.parentElement) {
      element = element.parentElement;
    }
  }

  throw new Error(`no context found for context element: ${elName}`);
};

const removeCtxChildElement = (ctxChildElement: ContextChildElement) => {
  if (ctxChildElement._hc_cleanups) {
    ctxChildElement._hc_cleanups.forEach((handle) => {
      handle()
    });
    ctxChildElement._hc_cleanups.length = 0;
  }
};

const removeCtxFragment = (ctxElement: ContextElement) => {
  const meta = ctxElement._hc_meta;
  if (meta) {
    const ctx = ctxMap.get(meta._hc_ctx);
    if (ctx) {
      ctx.fragments.delete(meta._hc_ctxId);
    }
    delete ctxElement._hc_meta;
  }
};
