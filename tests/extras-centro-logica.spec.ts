import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { test, expect } from '@playwright/test';
import { mensalidadeEmAtraso } from '@/lib/mensalidadeEmAtraso';
import { calcularExtrasDoMes, alunoForaDoHorarioHoje } from '@/lib/extrasCentro';

// Testes de lógica pura — sem Supabase, sem browser, sem depender da hora
// do dia (hoje é sempre passado como parâmetro). lib/mensalidadeEmAtraso.ts
// e lib/extrasCentro.ts são partilhadas por /admin/pagamentos, a Lista do
// Dia e a Área dos Encarregados — se estes passarem, os três ecrãs nunca
// podem divergir para os mesmos dados.

test.describe('lib/mensalidadeEmAtraso — mensalidadeEmAtraso', () => {
  const base = { pago: false, valorEsperado: 50, ano: 2026, mes: 11, diaLimite: 8, hojeISO: '2026-11-10' };

  test('mês anterior ao atual: sempre em atraso, seja qual for o dia de hoje', () => {
    expect(mensalidadeEmAtraso({ ...base, mes: 10, hojeISO: '2026-11-01' })).toBe(true);
    expect(mensalidadeEmAtraso({ ...base, mes: 10, hojeISO: '2026-12-31' })).toBe(true);
  });

  test('mês atual, antes do dia limite: não está em atraso', () => {
    expect(mensalidadeEmAtraso({ ...base, hojeISO: '2026-11-05' })).toBe(false);
  });

  test('mês atual, exatamente no dia limite: não está em atraso (só depois)', () => {
    expect(mensalidadeEmAtraso({ ...base, hojeISO: '2026-11-08' })).toBe(false);
  });

  test('mês atual, depois do dia limite: em atraso', () => {
    expect(mensalidadeEmAtraso({ ...base, hojeISO: '2026-11-09' })).toBe(true);
  });

  test('mês futuro: nunca em atraso, mesmo muito depois do dia limite desse mês', () => {
    expect(mensalidadeEmAtraso({ ...base, mes: 12, hojeISO: '2026-11-30' })).toBe(false);
  });

  test('pago=true: nunca em atraso, mesmo num mês anterior', () => {
    expect(mensalidadeEmAtraso({ ...base, mes: 10, pago: true, hojeISO: '2026-11-20' })).toBe(false);
  });

  test('valor esperado 0 ou nulo: nunca em atraso', () => {
    expect(mensalidadeEmAtraso({ ...base, mes: 10, valorEsperado: 0, hojeISO: '2026-11-20' })).toBe(false);
    expect(mensalidadeEmAtraso({ ...base, mes: 10, valorEsperado: null, hojeISO: '2026-11-20' })).toBe(false);
  });

  test('dezembro para janeiro: mês anterior através da virada do ano continua em atraso', () => {
    expect(mensalidadeEmAtraso({ ...base, ano: 2025, mes: 12, hojeISO: '2026-01-05' })).toBe(true);
  });
});

test.describe('lib/extrasCentro — calcularExtrasDoMes', () => {
  test('um aluno com consumos e dias fora, sem pagamento registado', () => {
    const resultado = calcularExtrasDoMes(
      [{ aluno_id: 'a1', consumos: 5, dias_fora: 20, total: 25 }],
      []
    );
    expect(resultado['a1']).toMatchObject({ consumos: 5, diasFora: 20, total: 25, pago: false, valorPago: null });
  });

  test('pagamento registado aplica-se ao aluno certo, sem afetar quem não tem pagamento', () => {
    const resultado = calcularExtrasDoMes(
      [
        { aluno_id: 'a1', consumos: 5, dias_fora: 0, total: 5 },
        { aluno_id: 'a2', consumos: 10, dias_fora: 0, total: 10 },
      ],
      [{ id: 'pag-1', aluno_id: 'a1', pago: true, valor_pago: 5, data_pagamento: '2026-11-01' }]
    );
    expect(resultado['a1']).toMatchObject({ pago: true, valorPago: 5, dataPagamento: '2026-11-01', pagamentoId: 'pag-1' });
    expect(resultado['a2']).toMatchObject({ pago: false, valorPago: null });
  });

  test('pagamento sem linha de totais (aluno sem consumos este mês) ainda aparece, com totais a 0', () => {
    const resultado = calcularExtrasDoMes([], [{ id: 'pag-1', aluno_id: 'a1', pago: true, valor_pago: 0, data_pagamento: '2026-11-01' }]);
    expect(resultado['a1']).toMatchObject({ consumos: 0, diasFora: 0, total: 0, pago: true, valorPago: 0 });
  });

  test('"valor mudou": total atual diferente do valor_pago registado — dado exposto para a UI decidir mostrar a nota', () => {
    const resultado = calcularExtrasDoMes(
      [{ aluno_id: 'a1', consumos: 5, dias_fora: 10, total: 15 }],
      [{ id: 'pag-1', aluno_id: 'a1', pago: true, valor_pago: 5, data_pagamento: '2026-11-01' }]
    );
    expect(resultado['a1'].total).not.toBe(resultado['a1'].valorPago);
  });

  test('sem totais nem pagamentos: objeto vazio', () => {
    expect(calcularExtrasDoMes([], [])).toEqual({});
  });

  test('aluno só com um dia "pendente" (sem totais, sem pagamento): cria entrada a 0€', () => {
    const resultado = calcularExtrasDoMes([], [], [{ alunoId: 'a1', dia: '2026-09-05', estado: 'pendente', valor: 10 }]);
    expect(resultado['a1']).toMatchObject({ consumos: 0, diasFora: 0, total: 0, pago: false, valorPago: null, pagamentoId: null });
  });

  test('aluno só com um dia "dispensado" (sem totais): também cria entrada a 0€', () => {
    const resultado = calcularExtrasDoMes([], [], [{ alunoId: 'a1', dia: '2026-09-05', estado: 'dispensado', valor: 10 }]);
    expect(resultado['a1']).toMatchObject({ consumos: 0, diasFora: 0, total: 0, pago: false });
  });

  test('aluno com dias (pendente + aceite) e consumos: o total continua a ser só o que vem em `totais` (consumos + aceites) — os dias em si nunca somam de novo', () => {
    const resultado = calcularExtrasDoMes(
      [{ aluno_id: 'a1', consumos: 5, dias_fora: 10, total: 15 }],
      [],
      [
        { alunoId: 'a1', dia: '2026-09-05', estado: 'aceite', valor: 10 },
        { alunoId: 'a1', dia: '2026-09-12', estado: 'pendente', valor: 10 },
      ]
    );
    expect(resultado['a1']).toMatchObject({ consumos: 5, diasFora: 10, total: 15 });
    expect(Object.keys(resultado)).toHaveLength(1); // não cria uma segunda entrada por aluno
  });

  test('dois alunos independentes: um só com dia por decidir (0€), outro com consumos — nenhum confunde o outro', () => {
    const resultado = calcularExtrasDoMes(
      [{ aluno_id: 'a2', consumos: 3, dias_fora: 0, total: 3 }],
      [],
      [{ alunoId: 'a1', dia: '2026-09-05', estado: 'pendente', valor: 10 }]
    );
    expect(resultado['a1']).toMatchObject({ total: 0 });
    expect(resultado['a2']).toMatchObject({ total: 3 });
  });

  test('aluno com dia pendente e pagamento registado (histórico, pago=false): não é tratado como "sem nada" — pagamentoId fica preenchido', () => {
    const resultado = calcularExtrasDoMes(
      [],
      [{ id: 'pag-1', aluno_id: 'a1', pago: false, valor_pago: null, data_pagamento: null }],
      [{ alunoId: 'a1', dia: '2026-09-05', estado: 'pendente', valor: 10 }]
    );
    expect(resultado['a1']).toMatchObject({ total: 0, pago: false, pagamentoId: 'pag-1' });
  });
});

test.describe('lib/extrasCentro — alunoForaDoHorarioHoje', () => {
  const diaSegunda = 1;
  const diaQuarta = 3;
  const diaSabado = 6;

  test('sala de estudo, ativo, com horário à segunda: fora do horário ao sábado', () => {
    expect(alunoForaDoHorarioHoje({ ativo: true, sala_estudo: true, aluno_horarios: [{ dia_semana: diaSegunda }] }, diaSabado)).toBe(true);
  });

  test('dentro do horário: não está fora', () => {
    expect(alunoForaDoHorarioHoje({ ativo: true, sala_estudo: true, aluno_horarios: [{ dia_semana: diaSegunda }, { dia_semana: diaQuarta }] }, diaQuarta)).toBe(false);
  });

  test('sem nenhuma linha em aluno_horarios: nunca está fora (falta configurar, não é um dia fora)', () => {
    expect(alunoForaDoHorarioHoje({ ativo: true, sala_estudo: true, aluno_horarios: [] }, diaSabado)).toBe(false);
    expect(alunoForaDoHorarioHoje({ ativo: true, sala_estudo: true, aluno_horarios: null }, diaSabado)).toBe(false);
  });

  test('aluno inativo: nunca está fora, mesmo com horário a não bater', () => {
    expect(alunoForaDoHorarioHoje({ ativo: false, sala_estudo: true, aluno_horarios: [{ dia_semana: diaSegunda }] }, diaSabado)).toBe(false);
  });

  test('aluno de explicações (sala_estudo=false): nunca está fora', () => {
    expect(alunoForaDoHorarioHoje({ ativo: true, sala_estudo: false, aluno_horarios: [{ dia_semana: diaSegunda }] }, diaSabado)).toBe(false);
  });
});
