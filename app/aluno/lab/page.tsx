'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// LabAI desativado (lib/features.ts) — esta página nunca carrega dados do
// aluno nem chama a API; só redireciona. O middleware já intercepta
// /aluno/lab antes disto correr, mas esta redirecção fica como segunda
// camada. Ver LABAI_PENDENTE.md para o que falta resolver antes de reativar.
export default function LabAIDesativado() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
