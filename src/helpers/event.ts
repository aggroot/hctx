/*---------------------------------------------------------------------------------------------
*  Copyright (c) The hctx Contributors
*  
*  All rights reserved to copyright holders.
*  
*  See the AUTHORS file for a full list of contributors.
*  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

export const dispatch = (el: Document | Element, name: string, details = {}) => {
    el.dispatchEvent(
        newEvent(name, details)
    );
}


export const newEvent = (name: string, details = {}) => {
    return new CustomEvent(name, {
        detail: details,
        bubbles: false,
        // Allows events to pass the shadow DOM barrier.
        composed: false,
        cancelable: false,
    })
}
