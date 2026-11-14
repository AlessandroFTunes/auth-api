export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandle(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  console.error(error); // loga por dentro, não vaza detalhes ao cliente
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Erro interno" } },
    { status: 500 },
  );
}


export function dividr(a: number, b: number) {
  if (b === 0)
  {
    throw new AppError(400,"DIVISION_BY_ZERO","Impossivel dividir algo por 0")
  }
  return a / b;
}

async function teste() {

  try {
    dividr(10, 0);
  } catch (e) {
     return errorHandle(e);
    }
  }

  export async function main(){
    const res = await teste();
    console.log(res?.status , await res?.json);

  }
