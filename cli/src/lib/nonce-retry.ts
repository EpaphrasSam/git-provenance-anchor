type NonceError = {
  code?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  error?: unknown;
  info?: unknown;
};

function errorParts(error: unknown): unknown[] {
  const parts: unknown[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const value = queue.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);
    parts.push(value);
    if (typeof value !== "object") continue;
    const nested = value as NonceError;
    queue.push(nested.code, nested.message, nested.shortMessage, nested.error, nested.info);
  }

  return parts;
}

export function nonceTooLowNextNonce(error: unknown): number | undefined {
  const parts = errorParts(error);
  const isNonceTooLow = parts.some(
    (part) =>
      part === "NONCE_EXPIRED" ||
      (typeof part === "string" && /\bnonce too low\b/i.test(part))
  );
  if (!isNonceTooLow) return undefined;

  for (const part of parts) {
    if (typeof part !== "string") continue;
    const match = /\bnext nonce\s+(\d+)\b/i.exec(part);
    if (!match) continue;
    const nonce = Number(match[1]);
    if (Number.isSafeInteger(nonce)) return nonce;
  }

  return -1;
}

export async function submitWithNonceRetry<T>(
  getNonce: () => Promise<number>,
  submit: (nonce: number) => Promise<T>
): Promise<T> {
  const initialNonce = await getNonce();

  try {
    return await submit(initialNonce);
  } catch (error) {
    const reportedNonce = nonceTooLowNextNonce(error);
    if (reportedNonce === undefined) throw error;

    let freshNonce = -1;
    try {
      freshNonce = await getNonce();
    } catch {
      if (reportedNonce < 0) throw error;
    }
    const retryNonce = Math.max(freshNonce, reportedNonce);
    if (retryNonce <= initialNonce) throw error;
    return submit(retryNonce);
  }
}
