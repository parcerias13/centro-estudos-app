import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, history, anoEscolar, nomeAluno, fileBase64, fileUrl, mimeType } = body;

    let tomPedagogico = "Usa linguagem corrente, clara e madura. És um tutor profissional e focado.";
    
    if (anoEscolar <= 4) {
      tomPedagogico = "Usa linguagem muito simples, analógica e divertida. Explica as coisas usando desenhos animados, brincadeiras ou magia. Usa emojis para ser amigável. Elogia muito.";
    } else if (anoEscolar >= 5 && anoEscolar <= 8) {
      tomPedagogico = "Usa linguagem de jovem adolescente. Dinâmica, com exemplos de videojogos, desporto ou redes sociais. Evita ser aborrecido, mas não sejas infantil. Mantém o rigor.";
    } else if (anoEscolar >= 9) {
      tomPedagogico = "Linguagem rigorosa, académica mas muito clara. Trata o aluno como um jovem adulto a preparar-se para exames de alto risco. Foco na eficiência da informação.";
    }

    const systemInstruction = `
      O teu nome é Lab AI, um tutor de elite desenhado para fazer os alunos pensar.
      Estás a falar com o aluno: ${nomeAluno || 'Aluno'}. Ele está no ${anoEscolar || 'ensino'}º ano de escolaridade.
      
      A TUA PERSONALIDADE OBRIGATÓRIA:
      ${tomPedagogico}

      REGRAS DE OURO:
      1. NUNCA dês a resposta final de bandeja (especialmente em matemática/física). Dá o primeiro passo e pergunta o que fazer a seguir.
      2. Se o aluno enviar um documento (PDF ou Imagem), lê o conteúdo e ajuda-o a interpretá-lo e a resolvê-lo passo a passo.
      3. Se for pedido um Quiz, gera 5 perguntas de escolha múltipla (UMA DE CADA VEZ).
      4. Fala sempre em Português de Portugal (pt-PT).
    `;

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
    });

    const chat = model.startChat({ history: history || [] });

    let msgContent: any[] = [{ text: message || "Analisa o documento em anexo." }];
    
    let finalBase64 = fileBase64;

    // A MÁGICA DOS PDFs: Se vier um URL do Supabase, o nosso servidor descarrega e converte para a IA ler!
    if (fileUrl) {
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      finalBase64 = Buffer.from(arrayBuffer).toString('base64');
    }

    if (finalBase64 && mimeType) {
      msgContent.push({
        inlineData: {
          data: finalBase64,
          mimeType: mimeType
        }
      });
    }

    const result = await chat.sendMessage(msgContent);
    const responseText = result.response.text();

    return NextResponse.json({ response: responseText });

  } catch (error: any) {
    console.error("Erro no Lab AI:", error);
    return NextResponse.json({ error: 'Falha na comunicação com o motor AI.' }, { status: 500 });
  }
}