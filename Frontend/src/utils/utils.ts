/**
 * Format a numeric value to three significant digits.
 */
export function formatCellNumber(value: number): number;
export function formatCellNumber(value: number | null | undefined): number | string;
export function formatCellNumber(value: number | null | undefined): number | string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return parseFloat(parseFloat(String(value)).toPrecision(3));
};

export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));

      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      const toHex = (value: number) => value.toString(16).padStart(2, '0');

      return (
        `${toHex(bytes[0])}${toHex(bytes[1])}${toHex(bytes[2])}${toHex(bytes[3])}` +
        `-${toHex(bytes[4])}${toHex(bytes[5])}` +
        `-${toHex(bytes[6])}${toHex(bytes[7])}` +
        `-${toHex(bytes[8])}${toHex(bytes[9])}` +
        `-${toHex(bytes[10])}${toHex(bytes[11])}${toHex(bytes[12])}${toHex(bytes[13])}${toHex(bytes[14])}${toHex(bytes[15])}`
      );
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16;
    const value = char === 'x' ? Math.floor(random) : (random & 0x3) | 0x8;

    return Math.floor(value).toString(16);
  });
};

/**
 * Minimal fetch wrapper.
 */
export const handleFetchRequest = async (
  url: string,
  method: string,
  data: unknown,
  request: typeof fetch,
): Promise<void> => {
  const endpoint = url;
  const response = await request(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to make request');
  }
};
