import { defineConfig } from '@playwright/test';

// Testes de integração contra a app a sério (sessão real via /login), não
// contra funções isoladas — as rotas usam createServerClient + cookies(), que
// só existem dentro de um pedido HTTP real. `webServer` arranca "next start"
// (build de produção) antes dos testes e reaproveita um já em execução fora
// de CI, para não recompilar sempre.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run start',
    url: process.env.BASE_URL || 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
