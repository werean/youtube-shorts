````markdown
Atue como um engenheiro de software sênior responsável por projetar e implementar um MVP de uma aplicação WEB local para automação de criação de Shorts a partir de vídeos do YouTube.

Este MVP deve ser tratado explicitamente como a PRIMEIRA FASE de um PRODUTO FINAL, com foco máximo em:
- arquitetura modular
- pipeline extensível
- baixo acoplamento
- facilidade de evolução sem refatorações estruturais

O projeto NÃO deve ser tratado como script ou experimento.

---

## STACK OBRIGATÓRIA

### Frontend
- React + TypeScript
- Aplicação acessada via navegador
- Frontend apenas como camada de UI e orquestração visual

### Backend
- Python + FastAPI
- Arquitetura modular por domínio e pipeline
- Execução local

### Processamento
- yt-dlp para download
- Whisper com CUDA habilitado (GPU NVIDIA)
- FFmpeg com CUDA / NVENC habilitado
- LLM executado via Ollama em servidor local

### LLM
- Modelo: **gpt-oss:120b-cloud**
- Execução via **Ollama rodando localmente**
- Comunicação via HTTP (`/api/chat` ou `/api/generate`)
- Nenhum SDK de cloud
- Nenhuma API key
- Nenhuma dependência de OpenAI ou serviços externos

### GPU
- NVIDIA com CUDA disponível
- Whisper e FFmpeg DEVEM usar aceleração por GPU

---

## PRINCÍPIO FUNDAMENTAL DO PROJETO

O sistema deve ser modelado como um **PIPELINE DE PROCESSAMENTO DE VÍDEO ORIENTADO A ETAPAS**.

Cada etapa deve:
- ter responsabilidade única
- ser isolada
- ser testável
- poder ser substituída ou estendida sem impacto nas demais

Nenhuma etapa deve conhecer detalhes internos de outra.

---

## PIPELINE OBRIGATÓRIO (MVP)

1. Ingestão do vídeo  
2. Transcrição  
3. Construção de blocos semânticos  
4. Análise semântica com LLM (via Ollama local)  
5. Curadoria humana  
6. Renderização final (Short vertical)  

Esse pipeline deve ser explícito no código e facilmente extensível.

---

## ORGANIZAÇÃO DO BACKEND (EXEMPLO OBRIGATÓRIO OU EQUIVALENTE)

```text
backend/
 ├─ app/
 │   ├─ main.py
 │   ├─ api/
 │   │   ├─ jobs.py
 │   │   ├─ health.py
 │   ├─ core/
 │   │   ├─ config.py
 │   │   ├─ paths.py
 │   │   ├─ gpu.py
 │   ├─ pipeline/
 │   │   ├─ ingest.py
 │   │   ├─ transcription.py
 │   │   ├─ semantic_blocks.py
 │   │   ├─ analysis.py
 │   │   ├─ curation.py
 │   │   ├─ rendering.py
 │   ├─ llm/
 │   │   ├─ client.py      # HTTP client compatível com Ollama
 │   │   ├─ prompts.py
 │   ├─ video/
 │   │   ├─ ffmpeg.py
 │   │   ├─ vertical.py
 │   │   ├─ hooks.py
 │   ├─ models/
 │   │   ├─ job.py
 │   │   ├─ segment.py
 │   │   ├─ semantic_block.py
 │   │   ├─ cut.py
 │   └─ storage/
 │       ├─ files.py
 │       ├─ metadata.py
````

---

## FRONTEND (WEB)

* Interface simples no navegador
* Apenas UI e chamadas HTTP
* Nenhum processamento pesado no frontend

### Funcionalidades

* Inserir link do YouTube
* Acompanhar status do job
* Visualizar sugestões de cortes
* Aprovar / reprovar sugestões
* Gerar Shorts finais

---

## DOWNLOAD DO VÍDEO

* Usar yt-dlp
* Baixar apenas uma vez
* Persistir vídeo e metadata localmente
* Estrutura preparada para múltiplos cortes do mesmo vídeo

---

## TRANSCRIÇÃO (WHISPER)

* Whisper com CUDA habilitado
* Preferência: `large-v3`
* Gerar transcrição segmentada com:

  * start
  * end
  * text
* Persistir em JSON
* Arquitetura deve permitir futuramente:

  * word-level timestamps
  * troca do modelo ASR
  * análise de pausas e silêncio

---

## CONSTRUÇÃO DE BLOCOS SEMÂNTICOS (ETAPA CRÍTICA)

Após a transcrição, o backend DEVE construir blocos semânticos antes de qualquer envio ao LLM.

### Definição de bloco semântico

* agrupamento de segmentos consecutivos do Whisper
* formando uma unidade de sentido completa
* respeitando pausas naturais e fronteiras de frase

### Regras

* nunca quebrar frases no meio
* respeitar pausas naturais
* duração alvo: 5s a 20s
* permitir até 30s apenas se a ideia exigir
* cada bloco deve ter início e fim naturais

### Formato do bloco

```json
{
  "block_id": "string",
  "start": 0.0,
  "end": 0.0,
  "text": "texto consolidado"
}
```

Essa etapa deve ser isolada para permitir evolução futura
(ex: análise prosódica, ritmo, silêncio, emoção).

---

## ANÁLISE SEMÂNTICA COM LLM

### Modelo

* **gpt-oss:120b-cloud via Ollama local**

O LLM **NÃO recebe transcrição bruta**.

Ele recebe:

* lista ordenada de blocos semânticos
* cada bloco com texto e timestamps

### Responsabilidade EXCLUSIVA do LLM

* avaliar blocos semânticos
* combinar blocos adjacentes quando fizer sentido
* sugerir cortes entre 15s e 60s
* garantir que o PRIMEIRO BLOCO do corte seja um **HOOK forte**

### Critérios de HOOK

* impacto imediato nos primeiros 1–3 segundos
* afirmação forte
* quebra de expectativa
* opinião clara
* evitar introduções e contexto dependente

### Formato de OUTPUT OBRIGATÓRIO (JSON puro)

```json
[
  {
    "blocks": ["b12", "b13"],
    "start": 42.1,
    "end": 71.2,
    "score": 94,
    "hook_reason": "Abertura com afirmação forte e provocativa",
    "content_reason": "Trecho autocontido com progressão clara"
  }
]
```

O prompt do LLM deve ficar isolado em arquivo próprio,
facilitando ajustes futuros de estratégia de hook.

---

## CURADORIA HUMANA

* Usuário aprova ou reprova sugestões
* Decisões persistidas
* Pipeline preparado para evolução futura:

  * aprovação automática
  * score mínimo
  * A/B testing de hooks
  * ranking por retenção

---

## RENDERIZAÇÃO (FFMPEG COM CUDA)

* FFmpeg com NVENC obrigatório
* Cada corte aprovado gera um vídeo FINAL

### FORMATO FINAL (MVP)

* Vertical 9:16
* 1080x1920
* Estratégia:

  * vídeo original centralizado
  * fundo desfocado (blur background)

### HOOK DE INÍCIO (MÓDULO ISOLADO)

* remover silêncio inicial
* evitar corte de palavra
* permitir micro-ajuste de até +1s
* lógica isolada em `hooks.py` para evolução futura

---

## REGRAS IMPORTANTES

* LLM NUNCA edita vídeo
* Frontend nunca processa mídia
* Backend orquestra todo o pipeline
* Cada etapa deve ser extensível sem refatorar etapas anteriores

---

## NÃO IMPLEMENTAR NO MVP

* Legendas no vídeo
* Crop inteligente por rosto
* Upload para plataformas
* Autenticação
* Multi-usuário
* Fila distribuída

---

## OBJETIVO FINAL DO MVP

* Usuário acessa pelo navegador
* Insere link do YouTube
* Recebe sugestões com hooks fortes
* Aprova os melhores cortes
* Recebe vídeos verticais prontos para Shorts
* Código preparado para evolução sem mudanças estruturais

Implemente com foco absoluto em arquitetura limpa,
pipeline modular e extensibilidade de longo prazo.

```
```
