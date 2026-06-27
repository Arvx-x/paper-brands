/** Stable blind label for slate position i: A..Z, then AA, AB, ... (never collides). */
export function optionLabel(i: number): string {
  let n = i, s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `OPTION-${s}`;
}
