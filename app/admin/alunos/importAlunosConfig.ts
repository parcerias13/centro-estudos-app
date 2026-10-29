// Import relativo (não "@/lib/username"): este ficheiro é importado
// dinamicamente por ~/Desktop/gestao-centros/validar-excel.mjs com Node puro
// (sem o bundler do Next.js, que é o único sítio que resolve o alias "@/*").
import { gerarUsernameBase, normalizarUsernameManual } from '../../../lib/username.ts';

export const CABECALHOS = [
  'Nome*',
  'Data Nascimento',
  'Ano Escolar*',
  'Mensalidade Base*',
  'Nome de Utilizador do Aluno',
  'Email Encarregado',
  'Telefone Encarregado',
  'Telemovel Aluno',
  'Dias Semana',
  'Saida Autorizada',
  'Usa App',
  'NIF Encarregado',
  'Morada Encarregado',
  'Modalidade',
] as const;

export const LINHA_EXEMPLO = [
  'Maria Silva',
  '15/03/2015',
  '4',
  '79',
  '',
  'mae@gmail.com',
  '912345678',
  '961234567',
  '1,3,5',
  'sim',
  'sim',
  '123456789',
  'Rua Exemplo, 123, Porto',
  'Sala de Estudo',
];

export interface AlunoImportado {
  nome: string;
  data_nascimento: string | null;
  email_encarregado: string | null;
  // Opcional — o aluno nunca dá email (proteção de dados); sem valor aqui, o
  // nome de utilizador é gerado automaticamente a partir do nome (ver
  // nomeUtilizadorDoAluno() abaixo e lib/username.ts).
  nome_utilizador: string | null;
  telefone_encarregado: string | null;
  ano_escolar: number | null;
  mensalidade_base: number | null;
  telemovel_aluno: string | null;
  dias_selecionados: number[];
  saida_autorizada: boolean | null;
  usa_app: boolean | null;
  nif_encarregado: string | null;
  morada_encarregado: string | null;
  sala_estudo: boolean;
  faz_explicacoes: boolean;
}

// Base do nome de utilizador (antes de qualquer sufixo de desambiguação em
// colisão, que só o servidor decide com uma tentativa real contra o Auth) —
// usada na pré-visualização e na deteção de colisões dentro do próprio
// ficheiro. A criação em si (app/api/admin/criar-aluno) faz exatamente a
// mesma normalização a partir dos mesmos dados.
export function nomeUtilizadorDoAluno(dados: AlunoImportado): string {
  if (dados.nome_utilizador) {
    const normalizado = normalizarUsernameManual(dados.nome_utilizador);
    if (normalizado) return normalizado;
  }
  return gerarUsernameBase(dados.nome);
}

// Chave de identidade para idempotência da importação: duas linhas (ou duas
// importações do mesmo ficheiro) com o mesmo nome e ano escolar são tratadas
// como o mesmo aluno — não se cria uma segunda conta. Já não usa a data de
// nascimento (passou a opcional, muitos centros não a têm). Não usa o nome
// de utilizador para esta deteção porque esse é só o login, não a identidade
// da pessoa.
//
// Risco aceite e tratado à parte (ver ImportarAlunosModal.tsx): dois alunos
// REAIS diferentes com o mesmo nome e o mesmo ano (homónimos) colidem nesta
// chave. Por isso uma colisão nunca é resolvida em silêncio — bloqueia a
// pré-visualização (colisão dentro do próprio ficheiro) ou fica sempre
// listada explicitamente no relatório final (colisão com um aluno já
// existente no centro).
export function chaveIdentidadeAluno(nome: string, anoEscolar: number | null): string {
  const nomeNormalizado = nome.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${nomeNormalizado}|${anoEscolar ?? ''}`;
}

// Modalidade da coluna opcional "Modalidade" do template — aceita variantes
// sem acentos e em qualquer capitalização. Vazio, ausente, ou valor não
// reconhecido = Sala de Estudo (o default de sempre), para nunca falhar a
// importação de um ficheiro antigo sem esta coluna.
export function paraModalidade(valor: unknown): { sala_estudo: boolean; faz_explicacoes: boolean } {
  const texto = removerAcentosParaModalidade(String(valor ?? '').trim().toLowerCase());
  if (texto === 'so explicacoes' || texto === 'explicacoes') {
    return { sala_estudo: false, faz_explicacoes: true };
  }
  if (texto === 'ambos') {
    return { sala_estudo: true, faz_explicacoes: true };
  }
  // 'sala de estudo', vazio, ou qualquer outra coisa não reconhecida.
  return { sala_estudo: true, faz_explicacoes: false };
}

function removerAcentosParaModalidade(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Rótulo curto da modalidade — usado nas mensagens de colisão/duplicado. */
export function rotuloModalidade(sala_estudo: boolean, faz_explicacoes: boolean): string {
  if (sala_estudo && faz_explicacoes) return 'Ambos';
  if (faz_explicacoes) return 'Só Explicações';
  return 'Sala de Estudo';
}

/**
 * Mensagem mostrada quando uma linha da importação colide (nome + ano) com
 * um aluno já existente no centro — nunca em silêncio: diz sempre a
 * modalidade atual desse aluno e, quando aplicável, sugere o caminho para
 * "Ambos" em vez de reimportar.
 */
export function fraseJaExisteComoModalidade(sala_estudo: boolean, faz_explicacoes: boolean): string {
  const rotulo = rotuloModalidade(sala_estudo, faz_explicacoes);
  if (sala_estudo && faz_explicacoes) return `Já existe como ${rotulo}.`;
  const outra = faz_explicacoes ? 'sala de estudo' : 'explicações';
  return `Já existe como ${rotulo}. Se também faz ${outra}, abre a ficha e muda para Ambos.`;
}

function normalizarParaComparacao(texto: string | null | undefined): string {
  return (texto ?? '').trim().toLowerCase();
}

/**
 * Deteta homónimos DENTRO do próprio ficheiro: duas (ou mais) linhas com o
 * mesmo nome e ano escolar — mesma `chaveIdentidadeAluno` — sem um "Nome de
 * Utilizador" manual que as distinga uma da outra. Em vez de assumir que são
 * a mesma pessoa (como aconteceria contra a base de dados) ou duplicar sem
 * aviso, bloqueia o grupo inteiro na pré-visualização: mais seguro quando
 * não há data de nascimento para desambiguar. Só deixa de bloquear se TODAS
 * as linhas do grupo tiverem um Nome de Utilizador próprio, não vazio, e
 * diferente entre si.
 */
export function detetarHomonimosNoFicheiro(linhas: LinhaImportacao[]): Map<number, string> {
  const porChave = new Map<string, LinhaImportacao[]>();
  for (const l of linhas) {
    const chave = chaveIdentidadeAluno(l.dados.nome, l.dados.ano_escolar);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave)!.push(l);
  }

  const bloqueios = new Map<number, string>();
  for (const grupo of porChave.values()) {
    if (grupo.length < 2) continue;
    const utilizadores = grupo.map((l) => normalizarParaComparacao(l.dados.nome_utilizador));
    const todosDistintosENaoVazios = utilizadores.every((u) => u !== '') && new Set(utilizadores).size === utilizadores.length;
    if (!todosDistintosENaoVazios) {
      for (const linha of grupo) {
        bloqueios.set(linha.linhaExcel, 'Possível duplicado ou homónimo: indica um Nome de Utilizador diferente para o importar');
      }
    }
  }
  return bloqueios;
}

export interface LinhaImportacao {
  linhaExcel: number;
  dados: AlunoImportado;
  erros: string[];
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function paraTextoOuNull(valor: unknown): string | null {
  const texto = String(valor ?? '').trim();
  return texto === '' ? null : texto;
}

function paraNumeroOuNull(valor: unknown): number | null {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (texto === '') return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

// Estrito: só um inteiro sozinho ("5", "05") ou inteiro seguido de "º",
// ".º", "º ano" ou ".º ano" (espaços opcionais, sem distinguir maiúsculas).
// Rejeita datas ("12/2026"), decimais ("5.5") e texto solto ("quinto") —
// ano_escolar passa a NOT NULL + CHECK (1-12) na base de dados, por isso um
// valor mal interpretado aqui escreveria o ano errado sem aviso nenhum.
const REGEX_ANO_ESCOLAR = /^(\d{1,2})\s*(\.?\s*º(\s*ano)?)?$/i;

function paraAnoEscolarOuNull(valor: unknown): number | null {
  const texto = String(valor ?? '').trim();
  if (texto === '') return null;
  const match = texto.match(REGEX_ANO_ESCOLAR);
  if (!match) return null;
  const numero = parseInt(match[1], 10);
  return numero >= 1 && numero <= 12 ? numero : null;
}

function paraBooleanoOuNull(valor: unknown): boolean | null {
  const texto = String(valor ?? '').trim().toLowerCase();
  if (texto === '') return null;
  return ['sim', 's', 'true', '1', 'yes'].includes(texto);
}

function paraDiasSelecionados(valor: unknown): number[] {
  const texto = String(valor ?? '').trim();
  if (texto === '') return [];
  return texto
    .split(',')
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 6);
}

function paraDataNascimento(valor: unknown): string | null {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const dia = String(valor.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  const texto = String(valor ?? '').trim();
  if (texto === '') return null;

  const matchPT = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (matchPT) {
    const [, dia, mes, ano] = matchPT;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  const matchISO = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (matchISO) {
    const [, ano, mes, dia] = matchISO;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  return null;
}

export function mapearLinha(linhaBruta: Record<string, unknown>, linhaExcel: number): LinhaImportacao {
  const modalidade = paraModalidade(linhaBruta['Modalidade']);

  const dados: AlunoImportado = {
    nome: String(linhaBruta['Nome*'] ?? linhaBruta['Nome'] ?? '').trim(),
    // Opcional — muitos centros não têm a data de nascimento dos alunos.
    data_nascimento: paraDataNascimento(linhaBruta['Data Nascimento*'] ?? linhaBruta['Data Nascimento']),
    email_encarregado: paraTextoOuNull(linhaBruta['Email Encarregado*'] ?? linhaBruta['Email Encarregado'])?.toLowerCase() ?? null,
    nome_utilizador: paraTextoOuNull(linhaBruta['Nome de Utilizador do Aluno']),
    telefone_encarregado: paraTextoOuNull(linhaBruta['Telefone Encarregado*'] ?? linhaBruta['Telefone Encarregado']),
    ano_escolar: paraAnoEscolarOuNull(linhaBruta['Ano Escolar*'] ?? linhaBruta['Ano Escolar']),
    mensalidade_base: paraNumeroOuNull(linhaBruta['Mensalidade Base*'] ?? linhaBruta['Mensalidade Base']),
    telemovel_aluno: paraTextoOuNull(linhaBruta['Telemovel Aluno']),
    dias_selecionados: paraDiasSelecionados(linhaBruta['Dias Semana']),
    saida_autorizada: paraBooleanoOuNull(linhaBruta['Saida Autorizada']),
    usa_app: paraBooleanoOuNull(linhaBruta['Usa App']),
    nif_encarregado: paraTextoOuNull(linhaBruta['NIF Encarregado']),
    morada_encarregado: paraTextoOuNull(linhaBruta['Morada Encarregado']),
    sala_estudo: modalidade.sala_estudo,
    faz_explicacoes: modalidade.faz_explicacoes,
  };

  const erros: string[] = [];
  if (!dados.nome) erros.push('Nome em falta');
  // Email e telefone do encarregado são agora opcionais — só contacto para
  // extratos, já não servem de login (o aluno nunca dá email).
  if (dados.email_encarregado && !REGEX_EMAIL.test(dados.email_encarregado)) erros.push('Email do Encarregado inválido');
  if (dados.ano_escolar === null) erros.push('Ano Escolar em falta ou inválido (1 a 12)');

  return { linhaExcel, dados, erros };
}
