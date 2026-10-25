// Nome de utilizador para login de alunos — substitui o email (nunca
// recolhido para alunos/famílias, por proteção de dados). O Supabase Auth só
// aceita email, por isso compomos um email de fachada com este sufixo fixo
// (domínio .invalid, nunca recebe nada). Ver PASSO 0 da conversa que criou
// este ficheiro: "@utilizador.invalid" foi aceite sem erro de validação por
// auth.admin.createUser + signInWithPassword.
export const SUFIXO_UTILIZADOR = '@utilizador.invalid';

export const MAX_TENTATIVAS_USERNAME = 20;

const TAMANHO_MAXIMO_USERNAME = 40;

function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Só [a-z0-9] — remove apóstrofos, hífenes, espaços e qualquer outro símbolo.
function limparParte(palavra: string): string {
  return removerAcentos(palavra).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Primeiro nome + último apelido (ignora nomes do meio e partículas como
// "da"/"dos"/"e") — "Maria João da Silva Costa" dá "maria.costa". Nome de
// uma só palavra usa só essa palavra, sem ponto.
export function gerarUsernameBase(nomeCompleto: string): string {
  const palavras = nomeCompleto
    .trim()
    .split(/\s+/)
    .map(limparParte)
    .filter((p) => p.length > 0);

  if (palavras.length === 0) return '';

  const base = palavras.length === 1 ? palavras[0] : `${palavras[0]}.${palavras[palavras.length - 1]}`;

  return base.slice(0, TAMANHO_MAXIMO_USERNAME);
}

// Candidato para a tentativa N de desambiguação em colisão (global, qualquer
// centro): 1ª tentativa é a base pura, as seguintes acrescentam 2, 3, ...
export function candidatoUsername(base: string, tentativa: number): string {
  return tentativa <= 1 ? base : `${base}${tentativa}`;
}

// Nome de utilizador escrito à mão (override na Nova Matrícula ou na coluna
// de importação) — mesma limpeza de caracteres que gerarUsernameBase, mas
// sem split em partes (o admin escreve já o formato final, ponto incluído).
export function normalizarUsernameManual(texto: string): string {
  return removerAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .slice(0, TAMANHO_MAXIMO_USERNAME);
}

export function emailFachada(username: string): string {
  return `${username}${SUFIXO_UTILIZADOR}`;
}

export function ehEmailFachada(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(SUFIXO_UTILIZADOR);
}

// Mostra o nome de utilizador sem o sufixo de fachada (ecrãs de leitura:
// ficha, perfil). Devolve null se não for um email de fachada.
export function usernameSemSufixo(email: string | null | undefined): string | null {
  if (!ehEmailFachada(email)) return null;
  return (email as string).slice(0, -SUFIXO_UTILIZADOR.length);
}

export function pareceEmail(texto: string): boolean {
  return texto.includes('@');
}

// Trim, minúsculas, remove TODOS os espaços — antes de decidir se o texto
// escrito no login é um email (tem "@") ou um nome de utilizador.
export function normalizarIdentificadorLogin(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, '');
}

// Texto escrito no campo de login -> email a usar em signInWithPassword.
export function identificadorParaEmailLogin(texto: string): string {
  const normalizado = normalizarIdentificadorLogin(texto);
  return pareceEmail(normalizado) ? normalizado : emailFachada(normalizado);
}
