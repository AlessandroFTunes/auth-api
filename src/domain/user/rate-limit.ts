import { AppError } from "../../error";

// Limitador em memória: vale para uma única instância e zera ao reiniciar.
export class AttemptLimiter {
  private registrosTentativa = new Map<
    string,
    { totalFalhas: number; bloqueadoAte: number; expiraEm: number }
  >();

  constructor(
    private readonly maximoFalhas = 3,
    private readonly duracaoBloqueio = 5 * 60 * 1000,
    private readonly relogioAtual: () => number = Date.now,
  ) {}

  // Lança 429 se a chave estiver bloqueada.
  verificarBloqueio(chaveTentativa: string): void {
    this.limparExpirados();
    const registro = this.registrosTentativa.get(chaveTentativa);
    const horaAtual = this.relogioAtual();
    if (registro && registro.bloqueadoAte > horaAtual) {
      const segundosEspera = Math.ceil((registro.bloqueadoAte - horaAtual) / 1000);
      throw new AppError(
        429,
        "TOO_MANY_ATTEMPTS",
        `Muitas tentativas. Tente novamente em ${segundosEspera}s`,
        segundosEspera,
      );
    }
  }

  registrarFalha(chaveTentativa: string): void {
    const horaAtual = this.relogioAtual();
    const registro = this.registrosTentativa.get(chaveTentativa);
    // bloqueio já vencido: recomeça a contagem
    const bloqueioVencido =
      registro !== undefined &&
      registro.bloqueadoAte > 0 &&
      registro.bloqueadoAte <= horaAtual;
    const totalFalhas = bloqueioVencido ? 1 : (registro?.totalFalhas ?? 0) + 1;
    this.registrosTentativa.set(chaveTentativa, {
      totalFalhas,
      bloqueadoAte:
        totalFalhas >= this.maximoFalhas ? horaAtual + this.duracaoBloqueio : 0,
      expiraEm: horaAtual + this.duracaoBloqueio,
    });
  }

  zerarFalhas(chaveTentativa: string): void {
    this.registrosTentativa.delete(chaveTentativa);
  }

  private limparExpirados(): void {
    const horaAtual = this.relogioAtual();
    for (const [chaveTentativa, registro] of this.registrosTentativa) {
      if (registro.expiraEm <= horaAtual) {
        this.registrosTentativa.delete(chaveTentativa);
      }
    }
  }
}
