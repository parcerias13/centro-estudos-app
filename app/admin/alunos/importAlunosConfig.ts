export const CABECALHOS = [
  'Nome*',
  'Data Nascimento*',
  'Email Encarregado*',
  'Email de Login do Aluno',
  'Telefone Encarregado*',
  'Ano Escolar*',
  'Mensalidade Base*',
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
  'mae@gmail.com',
  '',
  '912345678',
  '4',
  '79',
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
  // Opcional — só é preciso quando dois irmãos partilham o mesmo email do
  // encarregado, já que esse é o email de login por defeito (ver
  // emailLoginDoAluno() abaixo). Sem valor aqui, cai sempre no do encarregado.
  email_login: string | null;
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

export function emailLoginDoAluno(dados: AlunoImportado): string | null {
  return dados.email_login || dados.email_encarregado;
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
    email_login: paraTextoOuNull(linhaBruta['Email de Login do Aluno'])?.toLowerCase() ?? null,
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
  if (!dados.email_encarregado) erros.push('Email do Encarregado em falta');
  else if (!REGEX_EMAIL.test(dados.email_encarregado)) erros.push('Email do Encarregado inválido');
  if (dados.email_login && !REGEX_EMAIL.test(dados.email_login)) erros.push('Email de Login do Aluno inválido');
  if (!dados.telefone_encarregado) erros.push('Telefone do Encarregado em falta');
  if (dados.ano_escolar === null) erros.push('Ano Escolar em falta ou inválido (1 a 12)');

  return { linhaExcel, dados, erros };
}
