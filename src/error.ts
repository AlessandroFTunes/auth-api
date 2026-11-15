export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandle(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      {
        status: error.status,
        headers: error.retryAfter
          ? { "Retry-After": String(error.retryAfter) }
          : undefined,
      },
    );
  }

  console.error(error); // loga por dentro, não vaza detalhes ao cliente
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Erro interno" } },
    { status: 500 },
  );
}
