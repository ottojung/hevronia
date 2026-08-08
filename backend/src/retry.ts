import { HttpError } from "grammy";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientError(error: unknown): boolean {
  const messages: string[] = [];
  const collect = (err: unknown): void => {
    if (!(err instanceof Error)) {
      return;
    }
    messages.push(err.message);
    if (err instanceof HttpError) {
      collect(err.error);
      return;
    }
    if (err.cause instanceof Error) {
      collect(err.cause);
    }
  };
  collect(error);
  return messages.some((message) =>
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EPIPE|socket hang up|502|503|504/i.test(
      message,
    ),
  );
}
