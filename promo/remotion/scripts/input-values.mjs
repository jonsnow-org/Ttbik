/** Split scripted demo input into sequential values for visible form controls.
 * A single line preserves the historical one-field recording behavior.
 */
export function splitInputValues(value) {
  if (value == null || value === "") return [];
  return String(value).split(/\r\n|\n|\r/);
}
