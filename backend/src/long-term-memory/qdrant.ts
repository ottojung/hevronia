const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333";

export const QDRANT_READY_TIMEOUT_MS = 60_000;
export const QDRANT_READY_POLL_MS = 500;
export const QDRANT_READY_REQUEST_TIMEOUT_MS = 2_000;

export class InvalidQdrantUrlError extends Error {
  constructor() {
    super("QDRANT_URL must be an absolute HTTP or HTTPS URL");
    this.name = "InvalidQdrantUrlError";
  }
}

export class QdrantUnavailableError extends Error {
  constructor(timeoutMs: number, lastFailure: string) {
    super(`Qdrant was not ready within ${timeoutMs}ms; last attempt: ${lastFailure}`);
    this.name = "QdrantUnavailableError";
  }
}

export function isInvalidQdrantUrlError(error: unknown): error is InvalidQdrantUrlError {
  return error instanceof InvalidQdrantUrlError;
}

export function isQdrantUnavailableError(error: unknown): error is QdrantUnavailableError {
  return error instanceof QdrantUnavailableError;
}

export function qdrantUrlFromEnv(): string {
  return canonicalQdrantUrl(process.env["QDRANT_URL"] ?? DEFAULT_QDRANT_URL);
}

export interface QdrantReadinessOptions {
  fetchImpl?: FetchImplementation;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  nowImpl?: () => number;
  timeoutMs?: number;
  pollMs?: number;
  requestTimeoutMs?: number;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function waitForQdrantReady(
  qdrantUrl: string,
  options: QdrantReadinessOptions = {},
): Promise<void> {
  const readyUrl = new URL("readyz", canonicalQdrantUrl(qdrantUrl));
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const nowImpl = options.nowImpl ?? Date.now;
  const timeoutMs = options.timeoutMs ?? QDRANT_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? QDRANT_READY_POLL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? QDRANT_READY_REQUEST_TIMEOUT_MS;
  const startedAt = nowImpl();
  let lastFailure = "no response";

  while (nowImpl() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(readyUrl, {
        method: "GET",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.status === 200) {
        console.log("Qdrant readiness check succeeded");
        return;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? `${error.name}: ${error.message}` : "request failed";
    }
    if (nowImpl() - startedAt < timeoutMs) {
      await sleepImpl(pollMs);
    }
  }
  throw new QdrantUnavailableError(timeoutMs, lastFailure);
}

function canonicalQdrantUrl(configured: string): string {
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidQdrantUrlError();
    }
    return url.toString();
  } catch (error) {
    if (error instanceof InvalidQdrantUrlError) {
      throw error;
    }
    throw new InvalidQdrantUrlError();
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
