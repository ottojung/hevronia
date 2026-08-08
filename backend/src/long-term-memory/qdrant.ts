const DEFAULT_QDRANT_URL = "http://127.0.0.1:6333";

export class InvalidQdrantUrlError extends Error {
  constructor() {
    super("QDRANT_URL must be an absolute HTTP or HTTPS URL");
    this.name = "InvalidQdrantUrlError";
  }
}

export function isInvalidQdrantUrlError(error: unknown): error is InvalidQdrantUrlError {
  return error instanceof InvalidQdrantUrlError;
}

export function qdrantUrlFromEnv(): string {
  const configured = process.env["QDRANT_URL"] ?? DEFAULT_QDRANT_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return invalidQdrantUrl();
    }
    return url.toString();
  } catch {
    return invalidQdrantUrl();
  }
}

function invalidQdrantUrl(): never {
  throw new InvalidQdrantUrlError();
}
