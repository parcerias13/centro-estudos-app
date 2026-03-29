import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { extractText } from 'unpdf';
import { createClient } from '@supabase/supabase-js';
import cosineSimilarity from 'compute-cosine-similarity';

export const runtime = 'nodejs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// --- UTILITÁRIOS DE PERFORMANCE E CUSTO ---
function chunkText(text: string, size: number = 800): string[] {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.substring(i, i + size));
  }
  return chunks;
}

async function getRelevantContext(query: string, pdfText: string) {
  const chunks = chunkText(pdfText);
  const embeddingsResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [query, ...chunks],
  });
  const queryVector = embeddingsResponse.data[0].embedding;
  const chunkVectors = embeddingsResponse.data.slice(1);

  const scoredChunks = chunkVectors.map((v, i) => ({
    text: chunks[i],
    score: cosineSimilarity(queryVector, v.embedding) || 0
  }));

  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, 3) 
    .map(c => c.text)
    .join("\n\n---\n\n");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, history, anoEscolar, nomeAluno, fileUrl, mimeType, alunoId, resetContext } = body;

    if (!alunoId) return NextResponse.json({ error: 'ID em falta.' }, { status: 400 });

    // --- 0. RESET DE CONTEXTO ---
    if (resetContext) {
      await supabase.from('alunos').update({ ultimo_pdf_texto: null }).eq('id', alunoId);
      return NextResponse.json({ response: "Memória limpa! Podes enviar um novo tema ou PDF." });
    }

    // 1. GESTÃO FINANCEIRA E BUSCA DE MEMÓRIA
    const { data: alunoDb } = await supabase
      .from('alunos')
      .select('creditos_usados, ultimo_pdf_texto, ultimo_upload')
      .eq('id', alunoId)
      .single();

    const LIMITE_EUROS = 0.40;
    const creditosAtuais = Number(alunoDb?.creditos_usados || 0);

    if (creditosAtuais >= LIMITE_EUROS) {
        return NextResponse.json({ error: 'Limite mensal de 0.40€ atingido.' }, { status: 403 });
    }

    // --- 2. PASSO B: RATE LIMIT DE UPLOAD ---
    if (fileUrl && mimeType === 'application/pdf') {
      const agora = new Date();
      const ultimoUpload = alunoDb?.ultimo_upload ? new Date(alunoDb.ultimo_upload) : new Date(0);
      const diferencaSegundos = (agora.getTime() - ultimoUpload.getTime()) / 1000;

      if (diferencaSegundos < 30) {
        return NextResponse.json({ 
          error: `Calma! Espera mais ${Math.ceil(30 - diferencaSegundos)} segundos para trocar de PDF.` 
        }, { status: 429 });
      }
    }

    // 3. MOTOR PEDAGÓGICO (A Tua Conduta Original)
    let tom = "Linguagem profissional.";
    if (anoEscolar <= 4) tom = "Linguagem lúdica, simples e motivadora.";
    else if (anoEscolar <= 8) tom = "Linguagem dinâmica e desafiante.";
    else if (anoEscolar >= 9) tom = "Linguagem académica rigorosa.";

    const systemInstruction = `
    És o Lab AI, tutor de ${nomeAluno} (${anoEscolar}º ano). O teu tom deve ser: ${tom}.
    REGRAS DE CONDUTA:
    1. IDIOMA: Responde em Português de Portugal (PT-PT).
    2. RESUMOS: Sê direto e útil. Usa analogias (Feynman) para explicar, mas entrega o conteúdo.
    3. EXATAS (Mat/Fis/Qui): Sê socrático. Guia com pistas, não dês a resposta.
    4. STEALTH: Age naturalmente, não menciones métodos técnicos.
    5. RESPOSTAS: Ajuda primeiro, desafia depois.
    `;

    // 4. LÓGICA DE MEMÓRIA E VALIDAÇÃO DE PDF
    let textoParaProcessar = alunoDb?.ultimo_pdf_texto || "";
    let userContent: any = message || "Analisa o material.";
    
    if (fileUrl && mimeType === 'application/pdf') {
      const res = await fetch(fileUrl);
      const pdfData = await extractText(new Uint8Array(await res.arrayBuffer()));
      const novoTexto = Array.isArray(pdfData.text) ? pdfData.text.join('\n') : (pdfData.text || "");

      if (novoTexto.trim().length < 100) {
        return NextResponse.json({ error: 'O PDF não contém texto legível.' }, { status: 422 });
      }

      textoParaProcessar = novoTexto;
      await supabase.from('alunos').update({ 
        ultimo_pdf_texto: textoParaProcessar,
        ultimo_upload: new Date().toISOString()
      }).eq('id', alunoId);
    }

    // 5. SELEÇÃO DE CONTEXTO
    if (textoParaProcessar) {
      if (textoParaProcessar.length < 4000) {
        userContent = `CONTEXTO INTEGRAL DO DOCUMENTO:\n${textoParaProcessar}\n\nPERGUNTA DO ALUNO: ${message}`;
      } else {
        const context = await getRelevantContext(message || "Resumo", textoParaProcessar);
        userContent = `CONTEXTO RELEVANTE DO PDF:\n${context}\n\nPERGUNTA DO ALUNO: ${message}`;
      }
    }

    // 6. HISTÓRICO (Janela de 6)
    const messages = [
      { role: "system", content: systemInstruction },
      ...(history || []).slice(-6).map((m: any) => ({ 
        role: m.role === 'model' ? 'assistant' : 'user', 
        content: m.parts[0].text 
      })),
      { role: "user", content: userContent }
    ];

    // --- 7. CHAMADA À API COM STREAMING ---
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages as any,
      temperature: 0.7,
      stream: true,
      stream_options: { include_usage: true } // Para podermos calcular o custo no fim
    });

    const encoder = new TextEncoder();

    // Criamos o ReadableStream para o Frontend
    const customStream = new ReadableStream({
      async start(controller) {
        let finalUsage: any = null;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            controller.enqueue(encoder.encode(content));
          }
          
          // Captura os tokens no último pedaço (chunk)
          if (chunk.usage) {
            finalUsage = chunk.usage;
          }
        }

        // --- 8. CÁLCULO E REGISTO FINANCEIRO (Dentro do Stream) ---
        if (finalUsage) {
          const pT = finalUsage.prompt_tokens;
          const cT = finalUsage.completion_tokens;
          const custoEuros = ((pT * 0.15 / 1000000) + (cT * 0.60 / 1000000)) * 0.92;
          
          await supabase.rpc('deduzir_e_logar_ia', {
            p_aluno_id: alunoId,
            p_custo_euros: custoEuros,
            p_modelo: "gpt-4o-mini",
            p_tokens_prompt: pT,
            p_tokens_completion: cT,
            p_prompt_resumo: message?.substring(0, 50) || "Consulta de PDF"
          });
        }

        controller.close();
      }
    });

    // Devolvemos o stream em vez de um JSON
    return new Response(customStream, {
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (e) {
    console.error("Erro Crítico:", e);
    return NextResponse.json({ error: 'Erro no processamento.' }, { status: 500 });
  }
}