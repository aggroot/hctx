/*---------------------------------------------------------------------------------------------
*  Copyright (c) The hctx Contributors
*  
*  All rights reserved to copyright holders.
*  
*  See the AUTHORS file for a full list of contributors.
*  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

const isMergeableObject = (val: any) => {
  let nonNullObject = val && typeof val === "object";
  return (
    nonNullObject &&
    Object.prototype.toString.call(val) !== "[object RegExp]" &&
    Object.prototype.toString.call(val) !== "[object Date]"
  );
};

const emptyTarget = (val: any) => {
  return Array.isArray(val) ? [] : {};
};

type OprtionArgument = {
  clone?: boolean;
  mergeArrayObjects?: boolean;
  new?: boolean;
  arrayMerge?:  (target: any, source: any, optionsArgument: OprtionArgument) => any
} | undefined

const cloneIfNecessary = (value: any, optionsArgument: OprtionArgument) => {
  let clone = optionsArgument && optionsArgument.clone === true;
  return clone && isMergeableObject(value)
    ? merge(emptyTarget(value), value, optionsArgument)
    : value;
};

const defaultArrayMerge = (target: any[], source: any[], optionsArgument: OprtionArgument) => {
  let destination = target.slice();
  let mergeArrayObjects = optionsArgument && optionsArgument.mergeArrayObjects === true;
  source.forEach((val: any, i: number) => {
    if (typeof destination[i] === "undefined") {
      destination[i] = cloneIfNecessary(val, optionsArgument);
    } else if (isMergeableObject(val) && mergeArrayObjects) {
      destination[i] = merge(target[i], val, optionsArgument);
    } else if (target.indexOf(val) === -1) {
      destination.push(cloneIfNecessary(val, optionsArgument));
    }
  });
  return destination;
};

const mergeObject = (target: { [x: string]: any; }, source: { [x: string]: any; }, optionsArgument: OprtionArgument) => {
  let destination = target;
  let options = optionsArgument || { new: true };
  let newObject = options.new || true;
  if (isMergeableObject(target)) {
    if (newObject) destination = {};
    Object.keys(target).forEach((key) => {
      destination[key] = cloneIfNecessary(target[key], optionsArgument);
    });
  }
  Object.keys(source).forEach((key) => {
    if (!isMergeableObject(source[key]) || !target[key]) {
      destination[key] = cloneIfNecessary(source[key], optionsArgument);
    } else {
      destination[key] = merge(target[key], source[key], optionsArgument);
    }
  });
  return destination;
};

export const merge = (target: any, source: any, optionsArgument: OprtionArgument): any => {
  let array = Array.isArray(source);
  let options = optionsArgument || { arrayMerge: defaultArrayMerge };
  let arrayMerge = options.arrayMerge || defaultArrayMerge;
  if (array) {
    return Array.isArray(target)
      ? arrayMerge(target, source, optionsArgument)
      : cloneIfNecessary(source, optionsArgument);
  } else {
    return mergeObject(target, source, optionsArgument);
  }
};

type Path = (string | symbol | number)[];

export type CustomHandler<T extends object = object> = {
  get?(target: T, property: string | symbol | keyof T, receiver: any, path: Path): any;
  set?(target: T, property: string | symbol | keyof T, value: any, receiver: any, path: Path): boolean;
}

export const createDeepProxy = <T extends object = {}> (
  target: T,
  customHandler: CustomHandler<T> = {},
  path: Path = []
): T => {
  const shouldProxy = (value: unknown): value is object => 
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const makeHandler = (path: Path) => {
    const handler: ProxyHandler<T> & CustomHandler<T> = {
      get(target, property, receiver) {
        let value = Reflect.get(target, property, receiver);
        if (customHandler.get) {
          value =  customHandler.get(target, property, receiver, path);
        }
        if (shouldProxy(value) && !(value as any).__isProxy) {
          const newPath = path.concat(property);
          return createDeepProxy(value as T, customHandler, newPath);
        }
        return value;
      },
      set(target, property, value, receiver) {
        Reflect.set(target, property, value, receiver);
        if (customHandler.set) {
          return customHandler.set(target, property, value, receiver, path);
        }else{
          return true
        }
      },
    };
    return handler;
  };

  Object.defineProperty(target, '__isProxy', {
    value: true,
    configurable: false
  });

  for (const key in target) {
    const value = target[key];
    if (shouldProxy(value)) {
      target[key] = createDeepProxy(value as T, customHandler, path.concat(key)) as T[Extract<keyof T, string>];
    }
  }

  return new Proxy(target, makeHandler(path));
}




export const isObject = (o: { constructor: ObjectConstructor; } | null) => {
if (typeof o === "object" && o !== null && o.constructor === Object) {
    return true;
}
return false;
};
