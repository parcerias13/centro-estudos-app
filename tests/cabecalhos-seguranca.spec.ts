import { test, expect } from '@playwright/test';

// Cabeçalhos de segurança definidos em next.config.ts (headers()) — sem
// login, só pedidos HTTP diretos. Confirma-se em / e /login porque são as
// duas únicas páginas acessíveis sem sessão.

const PAGINAS = ['/', '/login'];

for (const pagina of PAGINAS) {
  test(`cabeçalhos de segurança em ${pagina}`, async ({ request, baseURL }) => {
    const resposta = await request.get(`${baseURL}${pagina}`);
    const headers = resposta.headers();

    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(headers['strict-transport-security']).toBe('max-age=31536000');
  });
}
