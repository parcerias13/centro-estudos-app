import { test, expect } from '@playwright/test';
import {
  gerarUsernameBase,
  candidatoUsername,
  emailFachada,
  ehEmailFachada,
  usernameSemSufixo,
  pareceEmail,
  normalizarIdentificadorLogin,
  identificadorParaEmailLogin,
  SUFIXO_UTILIZADOR,
  MAX_TENTATIVAS_USERNAME,
} from '@/lib/username';

// Testes de lógica pura de lib/username.ts — sem Supabase, sem browser.

test.describe('lib/username — gerarUsernameBase', () => {
  test('acentos: José Silva -> jose.silva', () => {
    expect(gerarUsernameBase('José Silva')).toBe('jose.silva');
  });

  test('acentos (til): João Ferreira -> joao.ferreira', () => {
    expect(gerarUsernameBase('João Ferreira')).toBe('joao.ferreira');
  });

  test('apóstrofo: Noé D\'Ávila -> noe.davila', () => {
    expect(gerarUsernameBase("Noé D'Ávila")).toBe('noe.davila');
  });

  test('hífen: Maria Silva-Costa -> maria.silvacosta', () => {
    expect(gerarUsernameBase('Maria Silva-Costa')).toBe('maria.silvacosta');
  });

  test('uma só palavra: Madonna -> madonna (sem ponto)', () => {
    expect(gerarUsernameBase('Madonna')).toBe('madonna');
  });

  test('partículas no meio: Maria João da Silva Costa -> maria.costa', () => {
    expect(gerarUsernameBase('Maria João da Silva Costa')).toBe('maria.costa');
  });

  test('nome muito longo é cortado a 40 caracteres', () => {
    const nome = 'Anastasiapetronilajoaquina Wojciechowskaszczepanowicz';
    const base = gerarUsernameBase(nome);
    expect(base.length).toBeLessThanOrEqual(40);
    expect(base).toBe(base.slice(0, 40));
  });

  test('espaços extra e maiúsculas não afetam o resultado', () => {
    expect(gerarUsernameBase('  MARIA   COSTA  ')).toBe('maria.costa');
  });

  test('nome vazio dá string vazia', () => {
    expect(gerarUsernameBase('   ')).toBe('');
  });
});

test.describe('lib/username — candidatoUsername (colisão)', () => {
  test('1ª tentativa é a base pura, sem número', () => {
    expect(candidatoUsername('maria.costa', 1)).toBe('maria.costa');
  });

  test('tentativas seguintes acrescentam o número', () => {
    expect(candidatoUsername('maria.costa', 2)).toBe('maria.costa2');
    expect(candidatoUsername('maria.costa', 3)).toBe('maria.costa3');
    expect(candidatoUsername('maria.costa', 20)).toBe('maria.costa20');
  });

  test('limite de tentativas é 20', () => {
    expect(MAX_TENTATIVAS_USERNAME).toBe(20);
  });
});

test.describe('lib/username — email de fachada', () => {
  test('emailFachada junta o sufixo fixo', () => {
    expect(emailFachada('maria.costa')).toBe('maria.costa@utilizador.invalid');
    expect(SUFIXO_UTILIZADOR).toBe('@utilizador.invalid');
  });

  test('ehEmailFachada distingue email de fachada de email real', () => {
    expect(ehEmailFachada('maria.costa@utilizador.invalid')).toBe(true);
    expect(ehEmailFachada('maria@gmail.com')).toBe(false);
    expect(ehEmailFachada(null)).toBe(false);
    expect(ehEmailFachada(undefined)).toBe(false);
  });

  test('usernameSemSufixo remove o sufixo só quando é de fachada', () => {
    expect(usernameSemSufixo('maria.costa@utilizador.invalid')).toBe('maria.costa');
    expect(usernameSemSufixo('maria@gmail.com')).toBeNull();
  });
});

test.describe('lib/username — normalização e deteção no login', () => {
  test('pareceEmail detupla pela presença de "@"', () => {
    expect(pareceEmail('maria.costa')).toBe(false);
    expect(pareceEmail('admin@studycloud.pt')).toBe(true);
  });

  test('normalizarIdentificadorLogin: trim, minúsculas, remove espaços', () => {
    expect(normalizarIdentificadorLogin(' Maria.Costa ')).toBe('maria.costa');
    expect(normalizarIdentificadorLogin(' MARIA . COSTA ')).toBe('maria.costa');
    expect(normalizarIdentificadorLogin('  ADMIN@STUDYCLOUD.PT  ')).toBe('admin@studycloud.pt');
  });

  test('identificadorParaEmailLogin: utilizador sem "@" ganha o sufixo de fachada', () => {
    expect(identificadorParaEmailLogin('maria.costa')).toBe('maria.costa@utilizador.invalid');
    expect(identificadorParaEmailLogin('  Maria.Costa  ')).toBe('maria.costa@utilizador.invalid');
  });

  test('identificadorParaEmailLogin: texto com "@" é tratado como email, intacto', () => {
    expect(identificadorParaEmailLogin('Admin@StudyCloud.pt')).toBe('admin@studycloud.pt');
    expect(identificadorParaEmailLogin('  professor@demo.example ')).toBe('professor@demo.example');
  });
});
