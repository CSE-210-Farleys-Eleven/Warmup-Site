// @ts-check
/**
 * Sample module used to exercise CI on a clean pull request.
 */

/**
 * Doubles a number.
 * Returns NaN for non-finite input. Never throws.
 * @param {number} value
 * @returns {number}
 */
export function double(value) {
  return Number.isFinite(value) ? value * 2 : NaN;
}
