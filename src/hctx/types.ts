/*---------------------------------------------------------------------------------------------
*  Copyright (c) The hctx Contributors
*  
*  All rights reserved to copyright holders.
*  
*  See the AUTHORS file for a full list of contributors.
*  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

//this file contains the public types

export type NonPrimitiveObject = {
  [key: string]: object;
};


export type ImportCallback = () => Promise<{ default:  HContextCallback<{}> }>

export type Options = {
  getImportPath?: (ctxName: string) => string
  getImportCallback?: (ctxName: string) => ImportCallback
  actionAttr?: string;
  effectAttr?: string;
  ctxAttr?: string;
  isDev?:boolean
};

export type HContextOptions = {
  middleware?: MiddlewareCallback[];
};

export type ActionOptions =
  HContextOptions & {
    useRawElement?: boolean;
  }
export type EffectOptions =
  HContextOptions & {
    allowStateMutations?: boolean;
  };

export type HContext<D extends object> = {
  data: D;
  options?: HContextOptions;
  actions:
  | {
    options?: ActionOptions;
  }
  | ActionDefinition<D>;
  effects:
  | {
    options?: EffectOptions;
  }
  | EffectDefinition<D>;
};

export type CleanupCallback = () => Promise<void>;
export type OnCleanup = (handle: CleanupCallback) => void;

export type ActionDefinition<D extends object> = {
  [key: string]:
  | ((
    actionCtx: {
      el: HTMLElement;
      data: D;
      useStore: <T extends object = object>(store: Store<T>) => T
      execute: ActionCallback;
      onCleanup: OnCleanup
      details: ContextDetails
      event?: Event;
    },
    props: object
  ) => void | Promise<void>)
  | (ActionOptions & {
    handle: (
      actionCtx: {
        el: HTMLElement;
        data: D;
        useStore: <T extends object = object>(store: Store<T>) => T
        execute: ActionCallback;
        onCleanup: OnCleanup
        details: ContextDetails
        event?: Event;
      },
      props: object
    ) => void | Promise<void>;
    subscribe?: (args: {
      data: D,
      useStore: <T extends object = object>(store: Store<T>) => T
      add: <T extends object, K extends keyof T>(
        obj: T,
        property?: K,
      ) => void 
    }) => void,
  });
};

export type EffectDefinition<D extends object> = {
  [key: string]:
  | ((
    actionCtx: {
      el: HTMLElement;
      data: D;
      useStore: <T extends object = object>(store: Store<T>) => T
      onCleanup: OnCleanup,
      details: ContextDetails
      event?: Event;
    },
    props: object
  ) => void | Promise<void>)
  | (EffectOptions & {
    handle: (
      actionCtx: {
        el: HTMLElement;
        data: D;
        useStore: <T extends object = object>(store: Store<T>) => T
        onCleanup: OnCleanup,
        details: ContextDetails
        event?: Event;
      },
      props: object
    ) => void | Promise<void>;
    subscribe?: (args: {
      data: D,
      useStore: <T extends object = object>(store: Store<T>) => T
      add: <T extends object, K extends keyof T>(
        obj: T,
        property?: K,
      ) => void
    }) => void
  });
};

export type MiddlewareContext = {
  el: HTMLElement;
  details: ContextDetails;
  type: "action" | "effect"
};

export type MiddlewareCallback = (
  ctx: MiddlewareContext
) => boolean | void | Promise<void> | Promise<boolean>;

export type StoreCallback<T extends object = {}> = () => T;
export type Store<T extends object = any> = { uid: string; handle: StoreCallback<T> };

export type HContextCallback<D extends object> =
  () => HContext<D>;

export interface HContextEvent extends CustomEvent<ContextDetails> { }

export type ContextDetails = {
  isLocal?: boolean;
  phase: Phase;
  trigger: string;
  initTrigger: string;
  contextTag?: string;
};

export type Phase = "before" | "after";

export type ActionCallback = (
  reason: string | undefined,
  delay: number | undefined,
  callback: ((counter: number) => void) | undefined,
  times: number
) => void;

// Helper type to extract data type from a context callback
export type ExtractContextData<T> = T extends HContextCallback<infer D> ? D : never;

// Helper type to extract store type from a Store
export type ExtractStoreType<T> = T extends Store<infer S> ? S : never;
