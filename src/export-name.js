// @ts-check
/**
 * Name complete CSV exports from dataset labels, view scope and the model fingerprint.
 * Pure string helpers only: no parser/model runtime import, DOM or file access.
 */

/**
 * Make a lowercase ASCII filename component, stripping accents and edge hyphens.
 * @param {unknown} text A value to stringify; null/undefined become empty text.
 * @returns {string} At most 24 characters, or 'data' when no characters remain.
 */
const slug = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'data';

/**
 * `<A>_vs_<B>__<view>__<rows>r__<id>.csv`, e.g. step-count_vs_hours-of-sleep__pairs-obs__35r__a3f9c1.csv.
 * The view code is the source (f1 / f2 / pairs) and display (obs / bycat / bygrp), plus `-flt` when a
 * group filter or hidden legend groups narrow the export.
 * Callers provide two labels, a model fingerprint, valid source/mode and row count;
 * this helper does not inspect data or guarantee that a fingerprint is unique.
 * @param {{labels: string[], fingerprint: string}} dataset Dataset metadata.
 * @param {import('./model.js').TableOptions} options Selected table/export scope.
 * @param {number} rows Number of exported rows across every page, not the page size.
 * @returns {string} An ASCII CSV filename; empty labels fall back to 'data'.
 * @example
 * exportFileName({labels: ['Steps', 'Sleep'], fingerprint: 'abc123'},
 *   {source: 2, mode: 'detail'}, 35)
 * // => 'steps_vs_sleep__pairs-obs__35r__abc123.csv'
 */
export function exportFileName({ labels, fingerprint }, { source = 0, mode = 'detail', query = '', excludedGroups = [] }, rows) {
  const view = `${['f1', 'f2', 'pairs'][source]}-${{ detail: 'obs', category: 'bycat', group: 'bygrp' }[mode] ?? mode}`
    + (query.trim() || excludedGroups.length ? '-flt' : '');
  return `${slug(labels[0])}_vs_${slug(labels[1])}__${view}__${rows}r__${fingerprint}.csv`;
}
