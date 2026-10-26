# Function and file headers

New files in `src/` start with `// @ts-check` and a file header (some older files don't yet; add them when you change those files substantially). Every exported function, type and shared constant has a JSDoc header. Editors and `@ts-check` read these headers, so keep the types accurate.

## File header

```js
// @ts-check
/**
 * <One sentence: what this module is responsible for.>
 *
 * <Optional: key ideas a reader needs before reading the code, e.g. units,
 * coordinate spaces, threading (main thread or worker), or "pure functions,
 * no DOM".>
 */
```

Example from [src/scales.js](../src/scales.js):

```js
// @ts-check
/**
 * Axis scales and ticks. Pure functions, no DOM, so they can be unit-tested.
 *
 * A scale works in "t-space": the data value itself for a linear axis, log10 of
 * the value for a log axis.
 */
```

## Function header

```js
/**
 * <What it does, starting with a verb or a noun phrase. One line if possible.>
 * <Edge cases: what it returns for empty, invalid or non-finite input.>
 * <Errors: whether it throws, and when. Say "never throws" if callers rely on it.>
 * <Side effects: DOM changes, module state, network, timers. Omit if none.>
 * @param {<Type>} name                <meaning, units, allowed values>
 * @param {<Type>} [optionalName]      <meaning and default>
 * @returns {<Type>}                   <meaning>
 * @example
 * <short call>  // => <result>
 */
```

Example:

```js
/**
 * Ordinary least-squares fit y = slope * x + intercept.
 * Returns NaN for both when the fit is undefined (fewer than 2 points, or all x equal).
 * @param {XY[]} points
 * @returns {{slope: number, intercept: number}}
 * @example
 * linearFit([{x: 1, y: 2}, {x: 2, y: 4}, {x: 3, y: 5}, {x: 4, y: 8}])
 * // => {slope: 1.9, intercept: 0}
 */
export function linearFit(points) { ... }
```

## Type header

Use `@typedef` with `@property` lines when a type has more than three fields, or when a field needs explaining.

```js
/**
 * <What this object represents and who creates it.>
 * @typedef {Object} <Name>
 * @property {<Type>} field        <meaning, units>
 * @property {<Type>} [optional]   <meaning; when it is missing>
 */
```

## Rules

- **Say what, not how.** The header describes behavior and contract; the code shows the steps.
- **Always document edge cases** for empty input, NaN and Infinity, and whether the function throws.
- **Name units and ranges** (px, ms, `[-1, 1]`, 0-based index).
- **Private helpers** need a header only when the name and types don't make the purpose clear. A one-line `/** @param ... */` for types is enough.
- **Inline comments** explain *why* (a workaround, a browser quirk, a decision from a review), never restate the code.
- **No stale headers.** Changing a function's behavior means updating its header in the same commit.
- **No author names, dates or change logs** in headers; git history already has them.
