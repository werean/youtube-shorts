# Fase 1 — Marca d'água

## Objetivo

O usuário envia uma imagem, escolhe transparência, posição e tamanho, e decide entre três modos: em todos os vídeos, em nenhum, ou perguntar antes. Os cortes gerados saem com a marca conforme essa escolha.

Esta fase também cria o **perfil local** (`data/profile/`), no formato definitivo, porque a marca d'água é preferência do perfil e a pasta portátil só chega na fase 2.

## Depende de

- P7 (posição e tamanho), P17 (branch base) e P21 (enviar a imagem liga a marca?) respondidas.
  - Se P7 mudar para "fixos", os controles de posição e tamanho saem da tela e os valores viram constantes; o resto não muda.
  - Se P21 mudar para "sim", o envio da primeira imagem troca o modo de `never` para `always` e o destaque de `ui.md`, 4, deixa de existir; o resto não muda.

## Leitura obrigatória

- [architecture.md](../architecture.md): seções 1, 4.2 (só o bloco `watermark`), 4.3, 11 e 14.2.
- [api-contracts.md](../api-contracts.md): seções 1 e 2, e os tipos da fase 1 na seção 7.
- [ui.md](../ui.md): seções 0, 3, 4, 12, 15 e 16.
- [decisions.md](../decisions.md): D2, D8, D18, D23, D39, D40.

## Entregas

### Backend

1. **Perfil local.** `data/profile/profile.json` criado na primeira leitura, com `profile_id: "p_local"`, `accounts: []`, `preferences.settings` e `preferences.tool_configs` vazios, e o bloco `watermark` com os padrões de [architecture.md](../architecture.md), 11.2. Escrita atômica com o `AtomicJsonArtifactStore` existente.
2. **Imagem.** Validação pelos primeiros bytes e por decodificação com OpenCV; limites de 5 MB e de 16 a 4096 px; regravação como PNG com transparência em `data/profile/marca-dagua/watermark.png`. O nome original do arquivo é descartado.
3. **Rotas** da seção 2 de `api-contracts.md`, num roteador novo, aceitando só os aliases `active` e `p_local` nesta fase. As que escrevem usam `require_local_ui`.
4. **Regras de modo:** enviar a imagem **não muda** o modo (P21; quem escolhe é o usuário); remover a imagem volta para `never`; modo diferente de `never` sem imagem é recusado.
5. **Campo `watermark`** opcional em `POST /jobs/:id/render`, `POST /jobs/:id/run` e nas opções de `POST /jobs/batch/run`, repassado até a renderização. Resolução pela tabela de `architecture.md`, 11.3.
6. **Conferência antes de renderizar:** se a marca vai ser aplicada e a imagem não existe ou não decodifica, a renderização não começa (`400` `watermark_missing`).
7. **FFmpeg:** segunda entrada nos dois construtores de comando e as linhas novas no script de filtros, exatamente como em `architecture.md`, 11.4. Campo opcional novo em `FilterScriptOptions`.
8. **`require_local_ui`** (`architecture.md`, 14.2), num módulo reutilizável pelas próximas fases.
9. **Inventário:** rotas novas acrescentadas à seção 4.1 do `AGENTS.md` e ao `DESIGN.md` da raiz.
   - **Opcional (O4 do README):** acrescentar também as rotas existentes que estão fora do inventário (`architecture.md`, seção 15). Não faz parte do pedido do dono; pode ser cortado sem afetar mais nada.
10. `.gitignore`: `data/profile/`.

O campo `shorts[].watermark` do arquivo de informações **não** é desta fase (o arquivo nasce na fase 2). Nesta fase, o resultado fica só no log do job.

### Frontend

1. `GlassDialog` (arquivo próprio) e, dentro de `settings/settingsShared.tsx`, `SettingsSlider`, `SegmentedChoice`, `PositionGrid` e a constante `SETTINGS_CARD_CLASS` (`ui.md`, 0.2 e 0.3). `AppAndDepsSections.tsx` não é alterado: a constante `CARD_CLASS` de lá é privada e fica como está.
2. Entrada "Marca d'água" na árvore das Configurações e a seção inteira (`ui.md`, 3 e 4), com salvamento automático e todos os estados.
3. Diálogo "Adicionar a marca d'água?" (`ui.md`, 12), ligado a "Gerar cortes", "Renderizar aprovados" e ao início de lote com renderização.
4. `api/watermark.ts`, `hooks/useWatermark.ts`, e o campo `watermark` em `renderJob`, no pedido de `run` e nas opções de lote.
5. "Restaurar padrões" para a seção `watermark`: chama `PUT /profiles/:id/watermark` com `{ "opacity": 0.7, "position": "top-right", "size_percent": 18 }`. O modo e a imagem ficam.
6. Destaque do bloco "Quando usar" depois do primeiro envio de imagem (`ui.md`, 4).

## Arquivos que pode tocar

Criar:

- `backend/app/domain/profiles/__init__.py`, `profile_store.py`, `watermark.py`
- `backend/app/api/local_only.py`
- `backend/app/api/routers/profiles.py`
- `backend/tests/test_pp_phase1_watermark.py`
- `frontend/src/api/watermark.ts`
- `frontend/src/hooks/useWatermark.ts`
- `frontend/src/components/redesign/GlassDialog.tsx`
- `frontend/src/components/redesign/WatermarkAskDialog.tsx`
- `frontend/src/components/redesign/settings/WatermarkSection.tsx`

Alterar:

- `backend/app/core/paths.py` (caminho do perfil local)
- `backend/app/models/schemas.py` (modelos novos; campo opcional em `RunPipelineRequest` e `BatchPipelineOptions`)
- `backend/app/main.py` (registrar o roteador)
- `backend/app/api/routers/jobs_render.py`, `backend/app/api/routers/jobs.py` (ler o campo novo)
- `backend/app/application/orchestrator.py` (repassar o campo)
- `backend/app/domain/rendering/rendering_service.py`
- `backend/app/infrastructure/video/filter_script_builder.py`, `ffmpeg_executor.py`
- `shared/contracts.ts` (só acréscimos)
- `frontend/src/api/index.ts`, `rendering.ts`, `jobs.ts`, `batchPipeline.ts`
- `frontend/src/hooks/index.ts`, `useRenderingWorkflow.ts`, `useBatchPipelineWorkflow.ts`
- `frontend/src/components/redesign/settings/settingsShared.tsx`
- `frontend/src/components/redesign/SettingsHubModal.tsx`
- `frontend/src/App.tsx`
- `.gitignore`, `AGENTS.md` (inventário 4.1), `DESIGN.md` da raiz

Não pode alterar: `backend/app/core/settings.py`, `tool_configs.py`, `data/*.json`, qualquer componente fora de `components/redesign/`, `frontend/src/lib/tokens.css`, `tailwind.config.ts`.

## Fora de escopo

- Raiz, vários perfis, `video.info.json` (fase 2 e 3).
- Marca d'água em texto, animada ou por plataforma.
- Aplicar marca d'água em cortes já renderizados. Para isso o usuário gera de novo.
- Pré-visualização feita pelo FFmpeg.

## Testes

Em `backend/tests/test_pp_phase1_watermark.py`, tudo com `tmp_path`, imagens geradas em memória e FFmpeg falso:

- **Sem marca d'água, o comando e o script são idênticos aos de antes** (comparação de texto com a saída atual, nos dois construtores e em cada `vertical_mode`).
- Com marca d'água: o comando tem a segunda entrada logo depois do vídeo e antes de `-t`; o script tem as três linhas, nessa ordem, depois da legenda; com `burn_subtitles` desligado, as linhas continuam corretas.
- Geometria: para cada uma das 9 posições, `X` e `Y` esperados; `CAIXA_L` par para `size_percent` 5, 18, 33 e 50; `OPACIDADE` com 2 casas.
- Tabela de resolução (pedido × modo): as 9 combinações.
- Imagem: PNG, JPEG e WebP aceitos e regravados como PNG; GIF, SVG, texto renomeado para `.png`, arquivo de 6 MB e imagem de 5000 px recusados com a mensagem certa; o nome enviado (inclusive `..\..\x.png`) não influencia o caminho gravado.
- Regras de modo: enviar a primeira imagem deixa o modo em `never`; enviar com o modo em `ask` deixa em `ask`; remover volta para `never`; `PUT` com `always` sem imagem dá `400`.
- "Restaurar padrões": `PUT` com os três valores padrão não muda `mode` nem apaga a imagem.
- Caminho fixo: depois de qualquer envio, o arquivo está em `marca-dagua/watermark.png`; um `profile.json` editado à mão com `watermark.file` igual a `../x.png` não faz nenhuma rota ler, servir ou apagar outro arquivo.
- Renderização com marca pedida e arquivo ausente: não chama o FFmpeg nenhuma vez.
- Rotas: `GET` devolve os padrões num perfil novo; `require_local_ui` recusa cliente de fora e `Origin` de outro site, e aceita `localhost`.
- `POST /jobs/:id/render` com corpo vazio, com `{}` e só com `cut_ids` se comporta como antes.
- Os testes existentes de renderização (`test_phase6_rendering.py`, `test_curation_and_render.py`) passam sem alteração.

## Critério de pronto

1. `pytest` verde, a suíte inteira.
2. `cd frontend && bun run build` sem erro.
3. Capturas de tela em `docs/redesign/screenshots/profiles-publishing/fase-1/`: seção sem imagem, com imagem, logo depois do primeiro envio (bloco "Quando usar" em destaque), enviando, erro de imagem, os três modos, prévia em três posições, diálogo de pergunta.
4. Com `data/profile/` ausente e nenhuma marca configurada, uma renderização produz o mesmo comando de antes (coberto pelo teste de identidade).
5. Revisão aprovada pelo [review-checklist.md](../review-checklist.md).

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 1. Nenhum agente executa FFmpeg real.

## Modelos

Implementação e testes: Sonnet. Revisão: Opus.
