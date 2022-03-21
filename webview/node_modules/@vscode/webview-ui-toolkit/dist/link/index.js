// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Anchor as FoundationAnchor, anchorTemplate as template, } from '@microsoft/fast-foundation';
import { linkStyles as styles } from './link.styles';
/**
 * The Visual Studio Code link class.
 *
 * @public
 */
export class Link extends FoundationAnchor {
}
/**
 * The Visual Studio Code link component registration.
 *
 * @remarks
 * HTML Element: `<vscode-link>`
 *
 * @public
 */
export const vsCodeLink = Link.compose({
    baseName: 'link',
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
});
