export type ApiSuccess<T> = { data: T; requestId: string };
export type ApiPage<T> = { items: T[]; nextCursor: string | null };
export type ApiFailure = {
  error: {
    code: string;
    message: string;
    fields?: { path: string; reason: string }[];
    currentRevision?: number;
    runId?: string;
  };
  requestId: string;
};
