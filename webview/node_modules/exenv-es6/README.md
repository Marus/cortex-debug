# exenv-es6
React's ExecutionEnvironment module extracted as ES6 functions. Based on the ExecutionEnviroment module licensed under the MIT license by Facebook, Inc

## Package exports
`canUseDOM` - Checks if the DOM is available to access and use
`canUseWorkers` - Checks if Web Workers are available for use
`canUseEventListeners` - Checks if Event Listeners are available for use
`canUseViewport` - Checks if there is a viewport available

## Usage
```
npm i exenv-es6 --save
```

```js
import { canUseDOM } from "exenv-es6";

if (canUseDOM()) {
    // do something that requires the dom
}
```

_Inspired by [exenv](https://github.com/JedWatson/exenv) from [JedWatson](https://github.com/JedWatson)_