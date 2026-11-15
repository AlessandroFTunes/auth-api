// POR QUE EXISTE O DUMMY HASH
//
// Problema: o Bun.password.verify (argon2) é lento de propósito (~50-100 ms).
// Se o login só rodasse o verify quando o email existe, a resposta seria:
//   - email NÃO existe        -> erro quase na hora (~2 ms)
//   - email existe, senha ruim -> erro depois do verify (~80 ms)
// Mesmo com a mensagem de erro idêntica, quem medir o tempo de resposta
// descobre quais emails estão cadastrados (user enumeration via timing attack).
//
// Solução: quando o usuário não existe, rodamos um verify mesmo assim contra
// um hash falso e descartamos o resultado, só para gastar o mesmo tempo.
//
// Por que um hash "de verdade" e não uma string qualquer: o argon2 só faz o
// cálculo pesado se o hash tiver o formato válido (com os parâmetros de custo
// embutidos). Uma string inválida seria rejeitada quase de imediato e o
// vazamento voltaria. O hash falso é gerado com os parâmetros padrão do
// Bun.password.hash, os mesmos do cadastro: se mudar o custo no cadastro,
// o dummy acompanha automaticamente, desde que continue usando o padrão.
//
// Alternativa equivalente e mais simples: chamar Bun.password.hash(password)
// e descartar o resultado (mesmo custo, sem cache). Ficou assim por escolha.
//
// Sobre o cache: gerar o dummy também é lento, então é feito uma vez só.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= Bun.password.hash("dummy-password"));

// `hash` é undefined quando o usuário não foi encontrado: nesse caso a
// verificação roda contra o hash descartável e sempre retorna false.
export async function verifyPassword(
  password: string,
  hash: string | undefined,
): Promise<boolean> {
  if (hash === undefined) {
    await Bun.password.verify(password, await getDummyHash());
    return false;
  }
  return Bun.password.verify(password, hash);
}
