# tabbable [![CI](https://github.com/focus-trap/tabbable/workflows/CI/badge.svg?branch=master&event=push)](https://github.com/focus-trap/tabbable/actions?query=workflow:CI+branch:master) [![Codecov](https://img.shields.io/codecov/c/github/focus-trap/tabbable)](https://codecov.io/gh/focus-trap/tabbable) [![license](https://badgen.now.sh/badge/license/MIT)](./LICENSE)

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-9-orange.svg?style=flat-square)](#contributors)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Small utility that returns an array of all\* tabbable DOM nodes within a containing node.

<small>_\***all** has some necessary caveats, which you'll learn about by reading below._</small>

The following are considered tabbable:

- `<button>` elements
- `<input>` elements
- `<select>` elements
- `<textarea>` elements
- `<a>` elements with an `href` attribute
- `<audio>` and `<video>` elements with `controls` attributes
- the first `<summary>` element directly under a `<details>` element
- `<details>` element without a `<summary>` element
- elements with the `[contenteditable]` attribute
- anything with a non-negative `tabindex` attribute

Any of the above will _not_ be considered tabbable, though, if any of the following are also true about it:

- has a negative `tabindex` attribute
- has a `disabled` attribute
- either the node itself _or an ancestor of it_ is hidden via `display: none` (*see ["Display check"](#display-check) below to modify this behavior)
- has `visibility: hidden` style
- is nested under a closed `<details>` element (with the exception of the first `<summary>` element)
- is an `<input type="radio">` element and a different radio in its group is `checked`
- is a form field (button, input, select, textarea) inside a disabled `<fieldset>`

**If you think a node should be included in your array of tabbables _but it's not_, all you need to do is add `tabindex="0"` to deliberately include it.** (Or if it is in your array but you don't want it, you can add `tabindex="-1"` to deliberately exclude it.) This will also result in more consistent cross-browser behavior. For information about why your special node might _not_ be included, see ["More details"](#more-details), below.

## Goals

- Accurate (or, as accurate as possible & reasonable)
- No dependencies
- Small
- Fast

## Browser Support

Basically IE9+.

Why? It uses [Element.querySelectorAll()](https://developer.mozilla.org/en-US/docs/Web/API/Element/querySelectorAll) and [Window.getComputedStyle()](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle).

**Note:** When used with any version of IE, [CSS.escape](https://developer.mozilla.org/en-US/docs/Web/API/CSS/escape) needs a [polyfill](https://www.npmjs.com/package/css.escape) for tabbable to work properly with radio buttons that have `name` attributes containing special characters.

## Installation

```
npm install tabbable
```

Dependencies: _none_.

## API

### tabbable

```js
import { tabbable } from 'tabbable';

tabbable(rootNode, [options]);
```

Returns an array of ordered tabbable nodes (i.e. in tab order) within the `rootNode`.

Summary of ordering principles:

- First include any nodes with positive `tabindex` attributes (1 or higher), ordered by ascending `tabindex` and source order.
- Then include any nodes with a zero `tabindex` and any element that by default receives focus (listed above) and does not have a positive `tabindex` set, in source order.

#### rootNode

Type: `Node`. **Required.**

#### options

##### includeContainer

Type: `boolean`. Default: `false`.

If set to `true`, `rootNode` will be included in the returned tabbable node array, if `rootNode` is tabbable.

##### displayCheck

Type: `full` | `non-zero-area` | `none` . Default: `full`.

Configures how to check if an element is displayed, see ["Display check"](#display-check) below.

### isTabbable

```js
import { isTabbable } from 'tabbable';

isTabbable(node, [options]);
```

Returns a boolean indicating whether the provided node is considered tabbable.

#### options

##### displayCheck

Type: `full` | `non-zero-area` | `none` . Default: `full`.

Configures how to check if an element is displayed, see ["Display check"](#display-check) below.

### isFocusable

```js
import { isFocusable } from 'tabbable';

isFocusable(node, [options]);
```

Returns a boolean indicating whether the provided node is considered _focusable_.

All tabbable elements are focusable, but not all focusable elements are tabbable. For example, elements with `tabindex="-1"` are focusable but not tabbable.

#### options

##### displayCheck

Type: `full` | `non-zero-area` | `none` . Default: `full`.

Configures how to check if an element is displayed, see ["Display check"](#display-check) below.

### focusable

```js
import { focusable } from 'tabbable';

focusable(rootNode, [options]);
```

Returns an array of focusable nodes within the `rootNode`, in DOM order. This will not match the order in which `tabbable()` returns nodes.

#### rootNode

Type: `Node`. **Required.**

#### options

##### includeContainer

Type: `boolean`. Default: `false`.

If set to `true`, `rootNode` will be included in the returned focusable node array, if `rootNode` is focusable.

##### displayCheck

Type: `full` | `non-zero-area` | `none` . Default: `full`.

Configures how to check if an element is displayed, see ["Display check"](#display-check) below.

## More details

- **Tabbable tries to identify elements that are reliably tabbable across (not dead) browsers.** Browsers are inconsistent in their behavior, though — especially for edge-case elements like `<object>` and `<iframe>` — so this means _some_ elements that you _can_ tab to in _some_ browsers will be left out of the results. (To learn more about this inconsistency, see this [amazing table](https://allyjs.io/data-tables/focusable.html)). To provide better consistency across browsers and ensure the elements you _want_ in your tabbables list show up there, **try adding `tabindex="0"` to edge-case elements that Tabbable ignores**.
- (Exemplifying the above ^^:) **The tabbability of `<iframe>`s, `<embed>`s, `<object>`s, `<summary>`s, and `<svg>`s is [inconsistent across browsers](https://allyjs.io/data-tables/focusable.html)**, so if you need an accurate read on one of these elements you should try giving it a `tabindex`. (You'll also need to pay attention to the `focusable` attribute on SVGs in IE & Edge.) But you also might _not_ be able to get an accurate read — so you should avoid relying on it.
- **Radio groups have some edge cases, which you can avoid by always having a `checked` one in each group** (and that is what you should usually do anyway). If there is no `checked` radio in the radio group, _all_ of the radios will be considered tabbable. (Some browsers do this, otherwise don't — there's not consistency.)
- If you're thinking, "Why not just use the right `querySelectorAll`?", you _may_ be on to something ... but, as with most "just" statements, you're probably not. For example, a simple `querySelectorAll` approach will not figure out whether an element is _hidden_, and therefore not actually tabbable. (That said, if you do think Tabbable can be simplified or otherwise improved, I'd love to hear your idea.)
- jQuery UI's `:tabbable` selector ignores elements with height and width of `0`. I'm not sure why — because I've found that I can still tab to those elements. So I kept them in. Only elements hidden with `display: none` or `visibility: hidden` are left out. See ["Display check"](#display-check) below for other options.
- Although Tabbable tries to deal with positive tabindexes, **you should not use positive tabindexes**. Accessibility experts seem to be in (rare) unanimous and clear consent about this: rely on the order of elements in the document.
- Safari on Mac OS X does not Tab to `<a>` elements by default: you have to change a setting to get the standard behavior. Tabbable does not know whether you've changed that setting or not, so it will include `<a>` elements in its list.

### Display check

To reliably check if an element is tabbable/focusable, Tabbable defaults to the most reliable option to keep consistent with browser behavior, however this comes at a cost since every node needs to be validated as displayed. The `full` process checks for computed display property of an element and each of the element ancestors. For this reason Tabbable offers the ability of an alternative way to check if an element is displayed (or completely opt out of the check).

The `displayCheck` configuration accepts the following options:

- `full`: (default) Most reliably resemble browser behavior, this option checks that an element is displayed and all of his ancestors are displayed as well (Notice that this doesn't exclude `visibility: hidden` or elements with zero size). This check is by far the slowest option as it might cause layout reflow.
- `non-zero-area`: This option checks display under the assumption that elements that are not displayed have zero area (width AND height equals zero). While not keeping true to browser behavior, this option is much less intensive then the `full` option and better for accessibility as zero-size elements with focusable content are considered a strong accessibility anti-pattern.
- `none`: This completely opts out of the display check. **This option is not recommended**, as it might return elements that are not displayed, and as such not tabbable/focusable and can break accessibility. Make sure you know which elements in your DOM are not displayed and can filter them out yourself before using this option.

**_Feedback and contributions more than welcome!_**

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md).

## Contributors

In alphabetical order:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/tidychips"><img src="https://avatars2.githubusercontent.com/u/11446636?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Bryan Murphy</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/issues?q=author%3Atidychips" title="Bug reports">🐛</a> <a href="https://github.com/focus-trap/tabbable/commits?author=tidychips" title="Code">💻</a></td>
    <td align="center"><a href="http://davidtheclark.com/"><img src="https://avatars2.githubusercontent.com/u/628431?v=4?s=100" width="100px;" alt=""/><br /><sub><b>David Clark</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/commits?author=davidtheclark" title="Code">💻</a> <a href="https://github.com/focus-trap/tabbable/issues?q=author%3Adavidtheclark" title="Bug reports">🐛</a> <a href="#infra-davidtheclark" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/focus-trap/tabbable/commits?author=davidtheclark" title="Tests">⚠️</a> <a href="https://github.com/focus-trap/tabbable/commits?author=davidtheclark" title="Documentation">📖</a> <a href="#maintenance-davidtheclark" title="Maintenance">🚧</a></td>
    <td align="center"><a href="https://github.com/features/security"><img src="https://avatars1.githubusercontent.com/u/27347476?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Dependabot</b></sub></a><br /><a href="#maintenance-dependabot" title="Maintenance">🚧</a></td>
    <td align="center"><a href="https://github.com/idoros"><img src="https://avatars1.githubusercontent.com/u/574751?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Ido Rosenthal</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/issues?q=author%3Aidoros" title="Bug reports">🐛</a> <a href="https://github.com/focus-trap/tabbable/commits?author=idoros" title="Code">💻</a> <a href="https://github.com/focus-trap/tabbable/pulls?q=is%3Apr+reviewed-by%3Aidoros" title="Reviewed Pull Requests">👀</a> <a href="https://github.com/focus-trap/tabbable/commits?author=idoros" title="Tests">⚠️</a></td>
    <td align="center"><a href="http://www.khamilton.co.uk"><img src="https://avatars1.githubusercontent.com/u/4013283?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Kristian Hamilton</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/issues?q=author%3Akhamiltonuk" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/Andarist"><img src="https://avatars2.githubusercontent.com/u/9800850?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Mateusz Burzyński</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/commits?author=Andarist" title="Code">💻</a> <a href="https://github.com/focus-trap/tabbable/issues?q=author%3AAndarist" title="Bug reports">🐛</a> <a href="https://github.com/focus-trap/tabbable/commits?author=Andarist" title="Documentation">📖</a></td>
    <td align="center"><a href="https://stefancameron.com/"><img src="https://avatars3.githubusercontent.com/u/2855350?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Stefan Cameron</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/commits?author=stefcameron" title="Code">💻</a> <a href="https://github.com/focus-trap/tabbable/issues?q=author%3Astefcameron" title="Bug reports">🐛</a> <a href="#infra-stefcameron" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/focus-trap/tabbable/commits?author=stefcameron" title="Tests">⚠️</a> <a href="https://github.com/focus-trap/tabbable/commits?author=stefcameron" title="Documentation">📖</a> <a href="#maintenance-stefcameron" title="Maintenance">🚧</a></td>
  </tr>
  <tr>
    <td align="center"><a href="http://tylerhawkins.info/201R/"><img src="https://avatars0.githubusercontent.com/u/13806458?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Tyler Hawkins</b></sub></a><br /><a href="#tool-thawkin3" title="Tools">🔧</a> <a href="https://github.com/focus-trap/tabbable/commits?author=thawkin3" title="Tests">⚠️</a> <a href="#infra-thawkin3" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/focus-trap/tabbable/commits?author=thawkin3" title="Documentation">📖</a></td>
    <td align="center"><a href="https://github.com/pebble2050"><img src="https://avatars1.githubusercontent.com/u/47210889?v=4?s=100" width="100px;" alt=""/><br /><sub><b>pebble2050</b></sub></a><br /><a href="https://github.com/focus-trap/tabbable/issues?q=author%3Apebble2050" title="Bug reports">🐛</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
