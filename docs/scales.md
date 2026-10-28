# Axis scales and ticks

This page is the reference for [scales.js](../src/scales.js), the pure functions that turn data values into pixel positions and axis ticks for linear and log axes. It is for anyone changing how axes look or adding a new scale kind. Read Overview first, then the API entry for the function you are calling.

**Applies to:** `main` through PR #34 · **Files:** [scales.js](../src/scales.js), [scales.test.js](../test/scales.test.js) · **Related:** #1, #23, [renderers](renderers.md), [architecture](architecture.md)

## Overview

`scales.js` has no DOM code, so every function runs in Node and is unit-tested. [chart.js](../src/chart.js) uses it to build the axes; the renderers never call it, they only draw the pixel positions it produced.

A scale works in **t-space**: the data value itself for a linear axis, and `log10` of the value for a log axis. The visible range (the "view"), panning and zooming are all stored in t-space, so they are plain linear arithmetic whichever scale is active. Only `toT` and `fromT` know the difference between the two kinds.

## API

Every function below never throws, except where its **Edge cases** line says so.

### `toT(kind, v)` and `fromT(kind, t)`

Convert between a data value and t-space. They are inverses of each other.

| Parameter | Type | Description |
| --- | --- | --- |
| `kind` | `'linear' \| 'log'` | axis type |
| `v` / `t` | `number` | data value / t-space value |

**Returns:** `number`.

**Edge cases:** `toT('log', v)` is NaN when `v` is zero, negative or NaN.

```js
[toT('log', 1000), toT('log', 0), fromT('log', 3)]
// => [3, NaN, 1000]
```

### `isPlottable(kind, v)`

Says whether a value can be drawn on an axis of this kind.

**Returns:** `boolean`. True for finite numbers, and also above zero on a log axis.

```js
[isPlottable('log', 0), isPlottable('linear', 0), isPlottable('linear', Infinity)]
// => [false, true, false]
```

### `makeScale(kind, tDomain, range)` and `linearScale(domain, range)`

Build a `Scale` from a t-space domain to a pixel range. `linearScale` is shorthand for `makeScale('linear', ...)`.

| Parameter | Type | Description |
| --- | --- | --- |
| `kind` | `ScaleKind` | axis type |
| `tDomain` | `[number, number]` | visible extent in t-space |
| `range` | `[number, number]` | pixel positions of the two domain ends; may run backwards, as for a y axis |

**Returns:** `Scale`, an object with `kind`, `map(v)` (data value to pixel), `invert(px)` (pixel to data value) and `invertT(px)` (pixel to t-space).

**Edge cases:** `map` returns NaN for values the axis cannot show. A zero-width domain gives infinite or NaN pixels, not an error.

```js
const y = makeScale('log', [0, 3], [0, 300]);
[y.map(10), y.invert(200), y.invertT(200), y.map(-1)]
// => [100, 100, 2, NaN]
linearScale([0, 10], [100, 0]).map(2.5)
// => 75
```

### `niceStep(span, count)` and `niceTicks(min, max, count)`

`niceStep` picks a step of 1, 2 or 5 times a power of ten that gives about `count` intervals over `span`. `niceTicks` lists the multiples of that step inside `[min, max]`.

**Returns:** `number` for `niceStep`; `{ticks: number[], step: number}` for `niceTicks`.

**Edge cases:** `niceStep` treats a `count` below 1 as 1, gives 0 for a span of 0, and NaN for a negative or NaN span. `niceTicks` returns `{ticks: [], step: NaN}` for an empty (`min === max`), reversed or NaN range. Before PR #34 the empty range looped until it threw a `RangeError`. Ticks are `i * step`, so decimals can carry float noise; format them with `formatTick`.

```js
niceStep(100, 5)
// => 20
niceTicks(0, 10, 5)
// => {ticks: [0, 2, 4, 6, 8, 10], step: 2}
niceTicks(3, 3, 5)
// => {ticks: [], step: NaN}
```

### `logTicks(tMin, tMax, maxTicks = 8)`

Tick values for a log axis whose visible t-space range is `[tMin, tMax]`. Always powers of ten; when few decades are visible it adds 2 and 5, or 1 to 9, but only as many as fit within `maxTicks`.

**Returns:** `number[]` of data values, ascending.

**Edge cases:** a reversed or NaN range gives `[]`. A zero-width range gives the power of ten it sits on, if any.

How it picks (a55ae07 added the thinning): it starts at the level suited to the span, then moves to a coarser level while there are more than `maxTicks`.

| Visible span (decades) | Starting level | Ticks per decade |
| --- | --- | --- |
| under 1.5 | 1 to 9 | up to 9 |
| 1.5 to under 3.5 | 1, 2, 5 | up to 3 |
| 3.5 or more | powers of ten | 1 (and one tick every few decades past `maxTicks`) |

```js
[logTicks(0, 3), logTicks(0, 1), logTicks(0, 8, 5), logTicks(2, 2)]
// => [[1, 10, 100, 1000], [1, 2, 5, 10], [1, 100, 10000, 1000000, 100000000], [100]]
```

### `formatLogTick(v)` and `formatTick(v, step)`

Label text for ticks. `formatLogTick` gives plain numbers for moderate sizes and `1e6` style from 1,000,000 up and below 0.0001. `formatTick` uses just enough decimals for the tick step, none when the step is 1 or more.

| Parameter | Type | Description |
| --- | --- | --- |
| `v` | `number` | tick value in data units; above 0 for `formatLogTick` |
| `step` | `number` | distance between ticks, above 0 |

**Returns:** `string`. Thousands separators follow the browser locale.

**Edge cases:** `formatLogTick(0)` returns `"NaNe-Infinity"`; a log axis never has a zero tick. `formatTick` throws a `RangeError` for a step of 0, negative or NaN, so pass the step from `niceTicks`.

```js
[formatLogTick(1000), formatLogTick(2e6), formatLogTick(5e-5), formatLogTick(0.5)]
// => ['1,000', '2e6', '5e-5', '0.5']
[formatTick(2.5, 0.5), formatTick(1200, 100)]
// => ['2.5', '1,200']
```

### `paddedExtent(kind, values, pad = 0.06)`

The t-space extent of some data values, padded on each side by `pad` of the extent so points do not sit on the frame. Values the axis cannot show are ignored.

**Returns:** `[number, number]`, lowest and highest value in t-space.

**Edge cases:** nothing plottable gives `[0, 1]`. A single distinct value is widened by 1 on each side before padding, so the result always has a positive width.

```js
[paddedExtent('linear', [0, 10]), paddedExtent('log', [10, 1000, -1, 0]), paddedExtent('log', [0, -3])]
// => [[-0.6, 10.6], [0.88, 3.12], [0, 1]]
```

### `categoryLabelStep(pxPerUnit, widestLabelPx, gapPx = 8)`

How many categories to step between labels so the widest one does not overlap its neighbour: 1 shows every label, 3 shows every third.

**Returns:** `number`, at least 1. A degenerate axis (no width, negative or NaN spacing) returns 1, so labels are never hidden by mistake.

```js
[categoryLabelStep(50, 90), categoryLabelStep(200, 40), categoryLabelStep(0, 90)]
// => [2, 1, 1]
```

## Design

1. `chart.js` asks `paddedExtent` for the home view of each axis, in t-space.
2. It builds one `Scale` per axis with `makeScale`, mapping the view to the plot's pixel box.
3. It asks `niceTicks` (linear), `logTicks` (log) or `categoryLabelStep` (category x) for ticks, maps each with `scale.map`, and labels it with `formatTick` or `formatLogTick`.
4. Zoom and pan change the view; the scale is rebuilt, nothing else.

## Decisions

- **t-space instead of two code paths.** Pan and zoom code is one set of linear formulas for both kinds. The alternative, branching in every interaction, was rejected because it is where log-axis bugs would hide.
- **Log ticks thin out, not shrink.** When 1 to 9 would crowd (2,000 to 9,000 sit close together on a log axis), `logTicks` moves to the coarser 1, 2, 5 level instead of drawing labels that overlap.
- **Out-of-range values give NaN, not an error.** The chart counts and reports the points a log axis cannot show (see [renderers](renderers.md)) instead of failing.

## Limitations

- `niceTicks` can drop the tick at the top end because of float rounding. `niceTicks(2.2, 2.8, 3)` returns `{ticks: [2.2, 2.4000000000000004, 2.6], step: 0.2}` with no 2.8, because `2.8 / 0.2` is just under 14. Not fixed yet.
- Only linear and log axes exist. A category x axis stays linear.
- `formatTick` and `formatLogTick` depend on the browser locale for separators.

## Testing

[scales.test.js](../test/scales.test.js) covers linear and log maps and round trips, rejection of non-positive values, `paddedExtent`, `logTicks` at several spans (including the crowding case and a sweep that checks the result never exceeds `maxTicks`), `formatLogTick`, `niceTicks` (including the empty range) and `categoryLabelStep`.

```sh
npm test
```

## Follow-ups

- [ ] Keep the top tick in `niceTicks` when float rounding puts it just past `max`.
- [ ] Decide whether `formatTick` should throw or return the plain number for a bad step.
