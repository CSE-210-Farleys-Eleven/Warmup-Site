# Chart layout lifecycle

This reference describes per-chart width and fullscreen controls, especially the
cleanup/state-transfer contract needed when a legend toggle recreates a chart.

**Applies to:** `main` at `ef757cb`, with the #23 documentation update ·
**Files:** [`chart-layout.js`](../src/chart-layout.js), [`main.js`](../src/main.js),
[`chart.js`](../src/chart.js), [`styles.css`](../styles.css) ·
**Related:** [architecture](architecture.md), [PR #5 layout changes](pr5-review-fixes.md)

## API

### `addLayoutControls(container, onResize?, initialWidth?)`

| Parameter | Contract |
| --- | --- |
| `container` | Existing HTMLElement chart card with a `.scatter-toolbar`. |
| `onResize` | Synchronous redraw callback; defaults to a no-op and runs during setup. |
| `initialWidth` | `''`, `'640'`, `'800'`, `'960'` or `'1200'`; default `'960'`. Numeric strings are CSS-pixel caps. |

Returns a handle with `getWidth()` and `destroy(preserveFullscreen = false)`.
`getWidth()` returns the selected string; `''` means available width with no CSS
max-width cap. Width choices remain constrained by the available page width.

`destroy()` removes owned controls and document listeners, restores the previous
inline maxWidth and normally leaves native/fallback fullscreen. Native fullscreen
exit failures during cleanup are ignored. `destroy(true)` retains expanded state
and body-overflow metadata so a replacement layout handle can take ownership.

**Edge cases:** a missing toolbar returns an inert handle whose getter returns
`initialWidth`, without changing the DOM or invoking the callback. Callers supply
supported width values and an existing element; invalid objects are not validated.
The function changes the DOM and may invoke a caller callback that throws.

## Design

1. Save the card's prior inline maxWidth and attach width/fullscreen controls.
2. A width change updates maxWidth and invokes the redraw callback.
3. Fullscreen uses `requestFullscreen()` when supported. Rejection/unavailability
   activates `.chart-expanded`, records prior body overflow and locks body scroll.
4. Native fullscreen changes update the button's text and `aria-pressed` state.
   Escape exits the in-page fallback, restores scroll and focuses the button.
5. The chart owner calls `destroy` before replacing content. On a preserved redraw,
   the replacement handle reads the retained expansion/overflow metadata.

The page's global width control sets all chart defaults; per-chart selectors remain
independent overrides. `main.js` synchronizes the global `Mixed` display state.
CSS hides width selectors at 600 px and below; it does not change their saved state.

## Limitations

- Native fullscreen and clipboard are separate browser capabilities; fullscreen
  does not grant image-copy permission.
- A native exit failure triggered by the click handler may reject; only the
  cleanup path explicitly ignores exit failure. The documentation does not claim
  a new error-recovery mechanism.
- `onResize` also runs on state updates and may be followed by a ResizeObserver
  callback. This cleanup update does not optimize duplicate drawing calls.
- A native fullscreen view can scroll when its controls exceed viewport height.
- DOM tests exercise the in-page fallback, not actual native fullscreen rendering.

## Testing

Run `npm test` and `npm run typecheck`. The
[control tests](../test/controls.test.js) cover width changes, all-chart/per-chart
state, expanded-view transfer, Escape recovery and observer/theme cleanup.
For manual browser verification, resize a chart, enter/exit fullscreen, toggle a
group while expanded, then confirm body scrolling and keyboard focus recover.
