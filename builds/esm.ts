/*---------------------------------------------------------------------------------------------
*  Copyright (c) The hctx Contributors
*  
*  All rights reserved to copyright holders.
*  
*  See the AUTHORS file for a full list of contributors.
*  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { load } from '../src/hctx';

if (window){
    load();
}

export * from '../src/hctx/types'

export { start, load, newMid, newStore, defineContext } from  '../src/hctx';

// Re-export specific helper types for better discoverability
export type { ExtractContextData, ExtractStoreType } from '../src/hctx/types';
