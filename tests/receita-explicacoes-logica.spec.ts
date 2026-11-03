import { test, expect } from '@playwright/test';
import {
  calcularReceitaExplicacoesDoMes,
  aplicarPagamentoNaReceita,
  type SessaoExplicacaoRaw,
  type PagamentoExplicacaoRaw,
} from '@/lib/receitaExplicacoes';

// Testes de lógica pura de lib/receitaExplicacoes.ts — sem Supabase, sem
// browser. Mesma função usada por Pagamentos (aba Mensalidades) e
// Performance; se estes passarem, os dois ecrãs nunca podem divergir para
// os mesmos dados.

function sessao(partial: Partial<SessaoExplicacaoRaw> & { aluno_id: string }): SessaoExplicacaoRaw {
  return {
    nome: 'Aluno Teste',
    ativo: true,
    data: '2026-05-10',
    disciplina: 'Matemática',
    professor: 'Prof. Teste',
    valor_cobrado_familia: 15,
    ...partial,
  };
}

function pagamento(partial: Partial<PagamentoExplicacaoRaw> & { aluno_id: string }): PagamentoExplicacaoRaw {
  return {
    id: 'pag-1',
    pago: false,
    data_pagamento: null,
    valor_pago: null,
    ...partial,
  };
}

test.describe('lib/receitaExplicacoes — calcularReceitaExplicacoesDoMes', () => {
  test('um aluno com 2 sessões dadas: esperado soma as duas, sem pagamento registado', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 20 }),
      ],
      []
    );
    expect(resultado.porAluno['a1'].esperado).toBe(35);
    expect(resultado.porAluno['a1'].pago).toBe(0);
    expect(resultado.porAluno['a1'].emFalta).toBe(35);
    expect(resultado.totalEsperado).toBe(35);
    expect(resultado.totalPago).toBe(0);
  });

  test('uma sessão cancelada não entra — o chamador já deve filtrar por estado=ativa, mas o cálculo em si só vê o que lhe é passado', () => {
    // Simula o filtro já feito a montante: das 3 sessões reais (2 dadas +
    // 1 cancelada), só as 2 ativas chegam aqui.
    const resultado = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
      ],
      []
    );
    expect(resultado.porAluno['a1'].esperado).toBe(30);
  });

  test('sessão sem preço: conta 0€ no esperado e incrementa semPrecoCount', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a1', valor_cobrado_familia: null }),
      ],
      []
    );
    expect(resultado.porAluno['a1'].esperado).toBe(15);
    expect(resultado.porAluno['a1'].semPrecoCount).toBe(1);
    expect(resultado.sessoesSemPrecoTotal).toBe(1);
  });

  test('pago=true sem valor_pago (linha antiga): conta o esperado atual', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 })],
      [pagamento({ aluno_id: 'a1', pago: true, valor_pago: null })]
    );
    expect(resultado.porAluno['a1'].pago).toBe(15);
    expect(resultado.porAluno['a1'].emFalta).toBe(0);
    expect(resultado.porAluno['a1'].valorPagoRegistrado).toBeNull();
  });

  test('pago=true com valor_pago: conta o valor_pago, mesmo que o esperado atual seja maior (sessão dada depois de marcar pago)', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }), // dada depois de marcar pago
      ],
      [pagamento({ aluno_id: 'a1', pago: true, valor_pago: 15 })]
    );
    expect(resultado.porAluno['a1'].esperado).toBe(30);
    expect(resultado.porAluno['a1'].pago).toBe(15);
    expect(resultado.porAluno['a1'].emFalta).toBe(15); // faltam 15€
  });

  test('pago=false: pago é 0 independentemente de valor_pago (não deveria existir, mas não deve contar)', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 })],
      [pagamento({ aluno_id: 'a1', pago: false, valor_pago: 15 })]
    );
    expect(resultado.porAluno['a1'].pago).toBe(0);
    expect(resultado.porAluno['a1'].emFalta).toBe(15);
  });

  test('aluno inativo com sessões continua a contar (a dívida existe)', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [sessao({ aluno_id: 'a1', ativo: false, valor_cobrado_familia: 15 })],
      []
    );
    expect(resultado.porAluno['a1'].ativo).toBe(false);
    expect(resultado.porAluno['a1'].esperado).toBe(15);
  });

  test('dois alunos: totais são a soma dos dois', () => {
    const resultado = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a2', valor_cobrado_familia: 20 }),
      ],
      [pagamento({ aluno_id: 'a1', pago: true, valor_pago: 15 })]
    );
    expect(resultado.totalEsperado).toBe(35);
    expect(resultado.totalPago).toBe(15);
    expect(resultado.totalEmFalta).toBe(20);
  });

  test('sem sessões nem pagamentos: tudo a zero', () => {
    const resultado = calcularReceitaExplicacoesDoMes([], []);
    expect(resultado).toEqual({ porAluno: {}, totalEsperado: 0, totalPago: 0, totalEmFalta: 0, sessoesSemPrecoTotal: 0 });
  });
});

test.describe('lib/receitaExplicacoes — aplicarPagamentoNaReceita (atualização otimista local)', () => {
  test('marcar pago: pago passa a valor_pago, emFalta recalcula, totais sobem', () => {
    const base = calcularReceitaExplicacoesDoMes([sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 })], []);
    const atualizado = aplicarPagamentoNaReceita(base, 'a1', { id: 'pag-1', aluno_id: 'a1', pago: true, data_pagamento: '2026-05-20', valor_pago: 15 });
    expect(atualizado.porAluno['a1'].pago).toBe(15);
    expect(atualizado.porAluno['a1'].emFalta).toBe(0);
    expect(atualizado.porAluno['a1'].pagoRegistrado).toBe(true);
    expect(atualizado.totalPago).toBe(15);
  });

  test('desmarcar pago: pago volta a 0, emFalta volta ao esperado', () => {
    const base = calcularReceitaExplicacoesDoMes(
      [sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 })],
      [pagamento({ aluno_id: 'a1', pago: true, valor_pago: 15 })]
    );
    const atualizado = aplicarPagamentoNaReceita(base, 'a1', { id: 'pag-1', aluno_id: 'a1', pago: false, data_pagamento: '2026-05-20', valor_pago: null });
    expect(atualizado.porAluno['a1'].pago).toBe(0);
    expect(atualizado.porAluno['a1'].emFalta).toBe(15);
    expect(atualizado.totalPago).toBe(0);
  });

  test('não afeta outros alunos nem perde as sessões já carregadas do aluno atualizado', () => {
    const base = calcularReceitaExplicacoesDoMes(
      [
        sessao({ aluno_id: 'a1', valor_cobrado_familia: 15 }),
        sessao({ aluno_id: 'a2', valor_cobrado_familia: 20 }),
      ],
      []
    );
    const atualizado = aplicarPagamentoNaReceita(base, 'a1', { id: 'pag-1', aluno_id: 'a1', pago: true, data_pagamento: '2026-05-20', valor_pago: 15 });
    expect(atualizado.porAluno['a1'].sessoes).toHaveLength(1);
    expect(atualizado.porAluno['a2'].pago).toBe(0);
    expect(atualizado.totalEsperado).toBe(35);
  });
});
