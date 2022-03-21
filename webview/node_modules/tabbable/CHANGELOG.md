# Changelog

## 5.2.1

### Patch Changes

- 1d5fcb5: Fixed: Form elements in disabled fieldsets should not be tabbable/focusable (#413)

## 5.2.0

### Minor Changes

- bf0a8f0: Exposed an option to select the way that an element is checked as displayed

## 5.1.6

### Patch Changes

- f9f6d25: Replaces Karma/Mocha/Sinon/Chai in test suite with Jest/Dom Testing Library. Removes README reference to identifying anchor tags with an `xlink:href` attribute as tabbable since that information is incorrect.

## 5.1.5

### Patch Changes

- c048203: fix crash when radio button name attributes contain CSS selector special characters (#168)

## 5.1.4

### Patch Changes

- a188c71: use element.matches fallback for IE11 and Webkit5
- 0d4cdf8: Update the code to use const/let and function declarations only for the repo; this does NOT affect browser compatibility as the code is still transpiled when published into the `./dist` directory for various targets.

## 5.1.3

### Patch Changes

- 5579825: fixes to details elements
  - ignore elements nested under a closed details element
  - ignore any extra summary elements after the first summary element
  - add details element as tabbable in case it has no direct summary element

## 5.1.2

### Patch Changes

- d3c6514: Fix UMD build incorrectly using `focusTrap` as output name.
- 95563c2: Fix #99: Transpile ESM bundle down to the same browser target used for the CJS and UMD bundles. ESM is just the module system, not the browser target.

## 5.1.1

### Patch Changes

- fb49d23: Fix #96: Transpile non-minified bundles for expected browser targets.

## 5.1.0

### Minor Changes

- bd21d91: Add `focusable()` for getting all focusable nodes.

### Patch Changes

- 3665d0b: The TypeScript return type of `tabbable` has been fixed: Was `Array<Element>` (an `Element` is technically not focusable), is now `Array<HTMLElement | SVGElement>` (which are both still/also `Element` instances).
- 8a25135: Fixed: Tabbable elements in fixed-position (`position: fixed`) containers should now be consistently found in supported browsers.
- 9544de2: Replace `prepublishOnly` script with `prepare` script. This has the added benefit of running automatically when installing the package from GitHub (as supported by NPM) where the published `./dist` directory is not automatically included.
- 672f4a2: Add `focusable()` type definition.
- 2424c0f: Small improvements for improving tree-shakeability of this package. A missing `#__PURE__` annotation has been added to allow dropping one of the top-level calls (if its result stays unused) and removed minification of the file referenced as `package.json#module` to avoid dropping the comments (including existing `#__PURE__` annotations).

## 5.0.0

- Changed code formatting to use dangling commas where ES5 supports them.
- Fixed a bug where `<audio controls />` and `<video controls />` elements _without `tabindex` attribute specified_ would be deemed **NOT** tabbable in Chrome, but would be in FireFox, because Chrome has `tabIndex` (the DOM Element property) returning -1 (focusable, but not tabbable), while FireFox has `tabIndex` returning 0 (focusable, and tabbable), yet **both** browsers include these elements in the _regular tab order_ (as if `tabIndex` was 0 for both browsers). Now these elements are considered tabbable in Chrome too!
- Add any `<summary>` element directly under a `<details>` element as tabbable and focusable.
- **BREAKING**: Changes to the `isTabbableRadio()` internal function in order to better support nested radio buttons:
  - In case a form parent element exists, include only nested radio inputs from that form.
  - Ignore checked radio elements from forms different from the one the validated node belongs to.
  - NOTE: This may result in _less_ radio elements being flagged as tabbable depending on context from the "root" node given to `tabbable()`.
- **BREAKING**: The exports have changed to be all named, and separate, as follows in order to help make the module more compatible with tree shaking:
  - `tabbable` -> `import { tabbable } from 'tabbable';
  - `tabbable.isTabbable` -> `import { isTabbable } from 'tabbable';
  - `tabbable.isFocusable` -> `import { isFocusable } from 'tabbable';
- Also to help with tree shaking, `package.json` now states `sideEffects: false` to mark this module as having no side effects as a result of merely importing it.
- Added new UMD build, see `./dist/index.umd.*`.

## 4.0.0

- Improve performance by changing the method for detecting whether a DOM node is focusable or not. It's expected that this change will _not_ affect results; but this is a major version bump as a warning for you to check your edge cases before upgrading.

## 3.1.2

- Fix reference to root element that caused errors within Shadow DOM.

## 3.1.1

- Allow module to be imported by non-browser JavaScript.

## 3.1.0

- Add `tabbable.isFocusable` and `tabbable.isTabbable` functions.

## 3.0.0

- Add `[contenteditable]` elements.

## 2.0.0

- Add `<audio>` and `<video>` elements with `controls` attributes.
- Only consider radio buttons tabbable if they are the `checked` on in their group, or if none in their group are `checked`.

## 1.1.3

- Fix bug causing SVG elements to precede elements they should follow in the tab order in IE.

## 1.1.2

- Ensure `querySelectorAll` receives a string argument.

## 1.1.1

- Fix crash when you call `tabbable(document)` (passing the `document` element).

## 1.1.0

- Add `includeContainer` option.

## 1.0.8

- Allows operation against elements that reside within iframes, by inspecting the element to determine its correct parent `document` (rather than relying on the global `document` object).

## 1.0.7

- Ensure stable sort of `tabindex`ed elements even in browsers that have an unstable `Array.prototype.sort`.

## 1.0.6

- Check `tabindex` attribute (via `getAttribute`), in addition to `node.tabIndex`, to fix handling of SVGs with `tabindex="-1"` in IE.

## 1.0.5

- Children of `visibility: hidden` elements that themselves have `visibility: visible` are considered tabbable.

## 1.0.4

- Fix IE9 compatibility.

## 1.0.3

- Further improvements to caching.

## 1.0.2

- Fix overaggressive caching that would prevent `tabbable` from knowing an element's children had changed.

## 1.0.1

- Fix handling of `<a>` elements with `tabindex="0"`.

## 1.0.0

- Initial release.
