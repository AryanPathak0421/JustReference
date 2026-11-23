/** A readable random temporary password (letters + digits + symbol) from the browser's CSPRNG. */
export function generateTempPassword(length = 12): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!;
  const chars = [pick(letters), pick(digits), ...Array.from({ length: length - 3 }, () => pick(all)), '-'];
  // Shuffle (Fisher–Yates) so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
