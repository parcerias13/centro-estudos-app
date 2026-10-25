// Import relativo (não "@/lib/username"): este ficheiro é importado
// dinamicamente por ~/Desktop/gestao-centros/validar-excel.mjs com Node puro
// (sem o bundler do Next.js, que é o único sítio que resolve o alias "@/*").
import { gerarUsernameBase, normalizarUsernameManual } from '../../../lib/username.ts';

export const CABECALHOS = [
  'Nome*',
  'Data Nascimento*',
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
// importações do mesmo ficheiro) com o mesmo nome e data de nascimento são
// tratadas como o mesmo aluno — não se cria uma segunda conta. Não usa o
// nome de utilizador para esta deteção porque esse é só o login, não a
// identidade da pessoa.
export function chaveIdentidadeAluno(nome: string, dataNascimento: string | null): string {
  return `${nome.trim().toLowerCase()}|${dataNascimento ?? ''}`;
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
  const dados: AlunoImportado = {
    nome: String(linhaBruta['Nome*'] ?? linhaBruta['Nome'] ?? '').trim(),
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
  };

  const erros: string[] = [];
  if (!dados.nome) erros.push('Nome em falta');
  if (!dados.data_nascimento) erros.push('Data de Nascimento em falta ou inválida (usa DD/MM/AAAA)');
  // Email e telefone do encarregado são agora opcionais — só contacto para
  // extratos, já não servem de login (o aluno nunca dá email).
  if (dados.email_encarregado && !REGEX_EMAIL.test(dados.email_encarregado)) erros.push('Email do Encarregado inválido');
  if (dados.ano_escolar === null) erros.push('Ano Escolar em falta ou inválido (1 a 12)');

  return { linhaExcel, dados, erros };
}
