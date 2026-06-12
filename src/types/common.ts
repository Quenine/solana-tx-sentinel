export type TimestampMs = number;

export type Result<T, E extends Error = Error> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: E;
    };

export type TransactionSignature = string;
