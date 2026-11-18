# Perfis, marca d'água, pasta portátil, limpeza e publicação — Especificação

> **Estado em 18/11/2026 — leia antes do resto.**
>
> - **Fase 1 (marca d'água):** implementada, revisada e conferida na tela. Falta uma renderização real na GPU.
> - **Decisão do dono:** a sincronização entre vários computadores (a "pasta portátil" da fase 2 original) fica **adiada**. A spec dela é mantida como documento e **não deve ser implementada**.
> - **Emenda para o modo "só neste computador":** [local-first.md](./local-first.md) e [phases/phase-2-local.md](./phases/phase-2-local.md). Ela redefine as fases 2 a 6 para funcionar com o armazenamento atual, e cada arquivo de fase ganhou uma seção "Em modo local" no início.
> - **A emenda foi interrompida a pedido do dono e está incompleta:** o texto principal foi escrito, mas **não passou por revisão independente**, este README ainda descreve o plano original (tabela de fases, perguntas para o dono), e `decisions.md` ainda não registra o adiamento. Antes de implementar a fase 2, terminar a emenda e revisá-la.
> - **Implementação parada** depois da fase 1, a pedido do dono.

Cinco coisas novas no app, entregues em seis fases:

1. Marca d'água do usuário nos cortes gerados.
2. Pasta escolhida pelo usuário (inclusive num disco sincronizado, como o Google Drive) que leva vídeos e preferências de um computador para outro.
3. Perfis, que agrupam contas do YouTube e do TikTok e separam vídeos e preferências.
4. Limpeza de vídeos antigos e limite de tamanho da pasta, sempre com clique do usuário.
5. Publicação dos cortes no YouTube e no TikTok.

Este diretório é a fonte de verdade deste trabalho. O `AGENTS.md` da raiz continua valendo para invariantes de rotas, artefatos e concorrência. **Nada disto está implementado.**

## Perguntas para o dono

Cada linha é um ponto que a spec **não decidiu sozinha**. A coluna "Padrão assumido" é o que os documentos descrevem hoje. Responda **sim** para manter ou **não** para mudar. A coluna "Bloqueia" diz a partir de que fase a resposta é necessária.

### Pontos que já estavam em aberto

| # | Pergunta | Padrão assumido | Bloqueia |
|---|---|---|---|
| P1 | Agrupar as contas num "perfil" é o que você quer? | **Sim.** Um perfil tem nome, preferências, marca d'água, pasta de vídeos própria e zero ou mais contas (YouTube e TikTok). Na hora de publicar, o usuário escolhe entre as contas do perfil. | Fase 3 |
| P2 | Ao "adiar" o aviso de limite, o download ou a renderização que causou o aviso segue em frente? | **Sim.** A operação segue, a pasta fica acima do limite e o aviso volta depois de um dia. | Fase 4 |
| P3 | A exceção de tamanho também protege o vídeo da regra de idade? | **Não.** A exceção só tira o vídeo da conta do tamanho. Para escapar da idade, o vídeo precisa estar marcado como "manter". | Fase 4 |
| P4 | Arquivos marcados como "manter" contam para o limite de tamanho? | **Sim, contam**, porque ocupam espaço de verdade. Quando tudo o que resta está protegido, o aviso diz: "A pasta passou do limite, mas tudo o que resta está marcado como 'manter'. Desmarque algum vídeo ou aumente o limite." e não oferece "Apagar agora". | Fase 4 |
| P5 | Avisar que apagar numa pasta sincronizada apaga em todos os computadores? | **Sim.** O aviso aparece ao escolher a pasta, na tela de armazenamento, na lista de confirmação da limpeza e, com a pasta em uso, em todo lugar onde já se apaga hoje: o "Remover" da barra lateral (que passa a pedir confirmação só nesse caso) e o diálogo de apagar corte. Sem pasta escolhida, esses dois ficam como hoje. | Fases 2 e 4 |
| P6 | Dois computadores na mesma pasta: basta uma trava de "um por vez"? | **Sim.** O segundo computador abre em modo "somente leitura" e pode assumir o controle com um clique ("Usar neste computador"). A troca **sempre** pede o clique, mesmo quando o outro computador parece parado: o app nunca assume sozinho. O que já estava em andamento no outro computador termina; nada novo começa lá. | Fase 2 |
| P7 | Posição e tamanho da marca d'água: fixos ou configuráveis? | **Configuráveis, de forma simples:** 9 posições (grade 3×3) e um controle de tamanho. Padrão: canto superior direito, 18% da largura do vídeo, margem fixa. | Fase 1 |
| P8 | De onde vêm título, descrição e hashtags na publicação? | **Título:** o título do corte, editável. **Descrição:** o resumo do corte, editável. **Hashtags:** um texto padrão do perfil, acrescentado ao fim, editável. Nenhuma geração por IA nesta versão. | Fase 5 |

### Pontos novos, que apareceram ao escrever a spec

| # | Pergunta | Padrão assumido | Bloqueia |
|---|---|---|---|
| P9 | Uma pasta só (a "raiz") para vídeos **e** preferências, ou duas pastas separadas? | **Uma só.** O rascunho fala em "onde ficam os vídeos e onde ficam as preferências"; a spec assume uma única raiz com tudo dentro, que é o que faz a pasta funcionar sozinha em outro computador. | Fase 2 |
| P10 | O limite de tamanho vale para cada perfil ou para a pasta inteira? | **Pasta inteira:** soma os vídeos de todos os perfis, porque o que acaba é o espaço do disco ou do Drive. A lista de limpeza mostra de qual perfil é cada item. | Fase 4 |
| P11 | Na regra de idade, os cortes de um vídeo vencido também vencem? | **Sim, mas em segundo plano:** a lista mostra dois grupos. "Vídeos originais" vem marcado; "Cortes" vem **desmarcado** e o usuário marca se quiser. Na regra de tamanho, os cortes só entram se apagar todos os originais permitidos não bastar. | Fase 4 |
| P12 | Arquivos enviados do computador entram como "manter" mesmo sabendo que hoje o app **nunca move** o original? | **Sim, decisão mantida.** O mapeamento do código mostrou que o navegador sempre envia uma cópia e que `move_uploads` não é lida pela ingestão (ver [decisions.md](./decisions.md), D14). O motivo original ("pode ser a única cópia") hoje não acontece, mas a proteção continua sendo o lado seguro. | Fase 4 |
| P13 | YouTube: cada usuário cria o próprio projeto gratuito no Google Cloud? | **Sim.** A alternativa (um aplicativo único do projeto, embutido no app) joga sobre o autor a verificação do Google e o limite de 100 usuários. Ver [platforms.md](./platforms.md). | Fase 5 |
| P14 | TikTok: a primeira versão envia como **rascunho** para a caixa de entrada do TikTok, com aplicativo de desenvolvedor do próprio usuário, e só começa depois de um teste real? | **Sim.** Sem auditoria, a publicação direta só sai privada e em conta privada (por isso ela é a pergunta P23). Se o rascunho sofre a mesma restrição não foi confirmado. É um modo avançado, não o caminho de um clique. | Fase 6 |
| P15 | Ao escolher a pasta pela primeira vez, o que acontece com os vídeos que já existem? | **O app oferece trazê-los.** No mesmo disco, move os vídeos e os cortes (a pasta antiga fica só com o que o app não leva, como as transcrições). Em outro disco, copia, confere o tamanho e **não apaga** a origem; a tela diz onde os originais ficaram. Vídeo arquivado continua arquivado. Dois vídeos nunca são misturados numa pasta só. | Fase 2 |
| P16 | Pode entrar uma dependência nova no backend, a biblioteca gratuita `keyring`, para guardar os logins no cofre do sistema operacional? | **Sim.** É o que permite não gravar token em arquivo. | Fase 3 |
| P17 | A base é a branch `feature/arc-redesign-python`, e a dublagem (que só existe na branch `feature/arc-redesign-integrated`, sobre a interface antiga) fica fora desta spec? | **Sim.** | Fase 1 |
| P18 | Nome e foto da conta (que vêm da plataforma) podem ficar gravados na pasta sincronizada? | **Sim**, atualizados a cada login e apagados ao remover a conta. A política do YouTube fala em não guardar dados de usuário por tempo indefinido (em geral 30 dias); se isso vale para um app local com credencial do próprio usuário não foi confirmado. | Fase 5 |
| P19 | YouTube exige dizer se o vídeo é "feito para crianças". Quem decide? | **O usuário, uma vez por conta**, sem valor pré-marcado. A resposta fica lembrada e pode ser trocada em cada publicação. | Fase 5 |

### Pontos que as duas revisões da spec levantaram

| # | Pergunta | Padrão assumido | Bloqueia |
|---|---|---|---|
| P20 | A pergunta "Onde guardar seus vídeos?" aparece para todo mundo na primeira abertura, ou a escolha da pasta fica só em Configurações? | **Aparece para todos, uma única vez**, inclusive para quem já usa o app. "Agora não" resolve com um clique, mantém tudo como hoje e a pergunta não volta. É a única pergunta nova no caminho de quem só cola um link. Se a resposta for "só em Configurações", o diálogo deixa de existir e o resto não muda. | Fase 2 |
| P21 | Ao enviar a imagem da marca d'água pela primeira vez, a marca já liga em todos os vídeos? | **Não.** O modo continua "em nenhum" e a tela destaca a escolha entre os três modos, com o aviso de que a marca ainda está desligada. Você pediu três modos escolhidos pelo usuário; ligar sozinho seria decidir por ele. | Fase 1 |
| P22 | As rotas antigas que apagam (excluir vídeo, excluir corte, arquivar) e a que abre o seletor de pasta podem passar a recusar chamadas vindas de outro aparelho da rede ou de outro site? | **Sim, a partir da fase 2.** Para o app em si nada muda (ele roda no próprio computador). Hoje o backend aceita esses pedidos de qualquer origem: um site aberto no navegador ou outro aparelho da rede pode mandar excluir um vídeo, e com a pasta sincronizada isso apagaria em todos os computadores. É a única exceção à regra "rotas existentes não mudam". Se a resposta for "não", elas ficam como estão e o risco fica registrado. | Fase 2 |
| P23 | TikTok: além do rascunho, entra a **publicação direta**, que sem auditoria só sai como "Só eu" e em conta privada? | **Não.** Fica fora da primeira versão. A tela e os contratos já preveem o modo, para entrar depois sem refazer nada. | Fase 6 |

## O que muda e por quê

| Hoje (verificado no código) | Depois |
|---|---|
| A única pasta que o usuário escolhe é `media.base_dir` (`backend/app/core/settings.py:54-60`). Estado e configurações ficam em `data/`, dentro do repositório. | O usuário escolhe uma raiz. Vídeos, cortes, preferências do perfil e um arquivo de informações por vídeo ficam nela. |
| `job.json` guarda o caminho completo do vídeo e é por ele que `/videos` reconhece a pasta (`backend/app/api/routers/videos.py:71-94`). Mudar de computador cria um job duplicado. | O vídeo é reconhecido por um identificador gravado ao lado dele, em `video.info.json`. |
| `data/settings.json` mistura preferência do usuário com configuração da máquina e está versionado no git. | Preferências viajam com o perfil; configuração da máquina fica em cada computador. |
| Não há marca d'água. O FFmpeg recebe uma única entrada (`backend/app/infrastructure/video/ffmpeg_executor.py:55-104`). | Segunda entrada com a imagem, aplicada no fim do script de filtros. |
| Excluir é definitivo e sem confirmação no backend (`videos.py:201-229`). Não existe regra de idade nem de tamanho. | Limpeza por regra, com lista, confirmação e registro. |
| Não há contas, credenciais nem publicação. O único segredo é uma variável de ambiente (`backend/app/core/config.py:140`). | Contas por perfil, login guardado no cofre do sistema, fila de publicação. |

## Fora de escopo

- Agendar publicações, métricas de audiência, comentários, outras plataformas.
- Gerar título, descrição ou hashtags com IA.
- Sincronizar estado em andamento (transcrição, análise, cortes não aprovados). O segundo computador refaz.
- Servidor nosso, conta nossa, nuvem nossa. Quem carrega os dados é a pasta sincronizada.
- Marca d'água em texto, animada ou diferente por plataforma.
- Lixeira ou "desfazer" da limpeza. A exclusão é definitiva.
- Mover vídeos de um perfil para outro, e mover a pasta escolhida de lugar pelo app.
- Consertar o `rmtree` das rotas antigas de excluir e de arquivar. Elas só ganham a trava de P22 e, com a pasta em uso, uma confirmação na tela.
- Dublagem e qualquer trabalho da branch `feature/arc-redesign-integrated`.
- Consertar defeitos antigos que o mapeamento encontrou e que não bloqueiam este trabalho (lista em [architecture.md](./architecture.md), seção 15).

## Restrições

| Restrição | Valor |
|---|---|
| IA | 100% local. Nada aqui usa LLM. |
| Custo | Zero. As APIs de publicação são gratuitas e opcionais. |
| Servidor | Nenhum servidor nosso. |
| Rotas existentes | Intocadas. Só ganham campos **aditivos e opcionais** (`AGENTS.md`, seções 2 e 4.1). Exceção única, pendente de P22: quatro rotas passam a recusar chamadas de fora do computador, sem mudar corpo nem resposta. |
| Sem raiz e sem perfil configurados | O app funciona como hoje. Os únicos efeitos novos estão listados na regra 1, abaixo. |
| Exclusão | Nunca sem clique do usuário (a única exceção são temporários de JSON do próprio app, com alcance fechado). A **limpeza** nunca apaga fora da pasta de vídeos (as únicas exceções são as duas de estado local do job de um vídeo que acabou de ser apagado; regra 4). As outras exclusões com clique que esta spec cria ficam fora da limpeza, cada uma na sua rota e com alcance fixo: a imagem da marca d'água (`DELETE /profiles/:id/watermark/image`, já na fase 1), os arquivos de um perfil removido, a foto de uma conta, as cópias de conflito e os temporários esquecidos (regra 3). |
| Segredos | Nunca na raiz, nunca em log, nunca em resposta de rota nem em evento. |
| Arquivo ilegível | Nunca é sobrescrito, adotado nem apagado sozinho. |
| Interface | Mantém a identidade atual (vidro escuro estilo Arc). Reusa tokens e componentes de `frontend/src/lib/tokens.css` e `frontend/src/components/redesign/`. |
| Testes `pytest` | 100% mockados: sem rede, sem conta real, sem FFmpeg real, sem disco sincronizado real. |
| Frontend | Não existe infraestrutura de testes. A verificação é `cd frontend && bun run build` mais capturas de tela por estado. |
| O que agente não pode testar | Conta real, credencial de desenvolvedor, envio real, Drive real, segundo computador. Vai para [manual-validation.md](./manual-validation.md). |

Sobre a regra de isolamento do `AGENTS.md` (seção 2, "não edite `frontend/` a partir da sessão de backend"): por decisão do dono, **neste trabalho** a mesma frente edita `frontend/`, respeitando a identidade visual. Ver [decisions.md](./decisions.md), D24.

## Documentos

| Arquivo | Para quê |
|---|---|
| [decisions.md](./decisions.md) | Decisões tomadas e o motivo, o que foi descartado e as restrições das plataformas com fonte |
| [architecture.md](./architecture.md) | Modelo de dados, o que fica em cada lugar do disco, migração, trava, marca d'água, limpeza, publicação |
| [api-contracts.md](./api-contracts.md) | Todas as rotas novas e os acréscimos em `shared/contracts.ts` |
| [ui.md](./ui.md) | Cada tela e diálogo, com os componentes a reusar e o texto exato |
| [platforms.md](./platforms.md) | O que a pesquisa confirmou sobre YouTube e TikTok, e o passo a passo para o usuário |
| [review-checklist.md](./review-checklist.md) | O que a revisão independente verifica em cada fase |
| [manual-validation.md](./manual-validation.md) | Tudo o que precisa de conta real, envio real, Drive real ou segundo computador |
| [phases/](./phases) | Um arquivo por fase: escopo, arquivos, testes, critério de pronto |

Quem implementa uma fase lê: este README, o arquivo da fase e os documentos que ele citar. Não é preciso ler as outras fases.

## Entregas opcionais

Quatro itens entraram na spec sem terem sido pedidos. Cada um pode ser cortado sem mudar mais nada. Diga quais ficam.

| # | Item | Fase | Padrão | Se cortar |
|---|---|---|---|---|
| O1 | TikTok: publicação direta, além do rascunho | 6 | **Fora** (é a pergunta P23) | Nada muda; é o padrão. |
| O2 | Botão "Baixar de novo" num vídeo cujo original foi apagado | 4 | Dentro | O estado "Original apagado" só informa. |
| O3 | Seletor de pasta nativo no Windows | 2 | Dentro | A pasta é escolhida colando o caminho, que funciona sempre. |
| O4 | Acrescentar ao inventário do `AGENTS.md` rotas antigas que estão fora dele | 1 | Dentro | O inventário continua incompleto, como hoje. |

## Fases e status

Marque `[x]` ao concluir a fase **e** passar no critério de pronto dela. `[~]` significa código implementado, testado com mocks e revisado, com a validação manual ainda pendente em [manual-validation.md](./manual-validation.md).

| Status | Fase | Entrega | Depende de |
|---|---|---|---|
| `[ ]` | [1](./phases/phase-1.md) | Marca d'água | P7, P17, P21 |
| `[ ]` | [2](./phases/phase-2.md) | Pasta portátil, divisão de configurações e arquivo de informações por vídeo | 1, P5, P6, P9, P15, P20, P22 |
| `[ ]` | [3](./phases/phase-3.md) | Perfis e contas (sem login ainda) | 2, P1, P16 |
| `[ ]` | [4](./phases/phase-4.md) | Limpeza e notificação | 2 (e 3 para mostrar o perfil na lista), P2, P3, P4, P10, P11, P12 |
| `[ ]` | [5](./phases/phase-5.md) | Publicação no YouTube | 3, P8, P13, P18, P19 |
| `[ ]` | [6](./phases/phase-6.md) | Publicação no TikTok | 5, P14, P23 |

A ordem é a sugerida no rascunho e foi mantida. As fases 1 a 4 estão detalhadas. As fases 5 e 6 estão detalhadas até onde a pesquisa permite; cada uma começa por um "passo zero" que resolve o que ficou sem confirmação.

A fase 1 vem antes da pasta portátil. Por isso ela já cria o **perfil local** em `data/profile/`, no mesmo formato que depois vai para a raiz. Assim a fase 2 só precisa copiar, sem converter.

## Regras para quem implementa

1. **Sem raiz configurada, só muda o que está nesta lista.** Todo teste de fase inclui o caso "sem raiz e sem perfil", e o resultado é igual ao de antes, a não ser por:
   - `data/machine.json` e `data/profile/` passam a existir;
   - cada pasta de vídeo ganha um `video.info.json` (fase 2);
   - o diálogo "Onde guardar seus vídeos?" aparece uma vez (fase 2; P20);
   - renomear um vídeo para um nome que vira `.`, `..` ou vazio, para um nome reservado (`_archived`, `logs`) ou para o nome de uma pasta que já existe é recusado; na ingestão, um título que vira um desses nomes reservados usa o `job_id` como nome da pasta (fase 2; correção de um defeito que apaga dados);
   - uma pasta cujo `video.info.json` existe, não pode ser lido e que esta máquina ainda não conhecia não vira vídeo sozinha: aparece em Configurações → Pasta como "não reconhecida" (fase 2; só acontece com arquivos que esta spec cria);
   - quatro rotas existentes recusam chamadas de fora do computador (fase 2; P22).

   Qualquer outro efeito em modo local é erro.
2. **Rotas e contratos só crescem.** Não remova, não renomeie, não mude o significado de nada que o frontend lê. Rota nova entra também no inventário da seção 4.1 do `AGENTS.md` e no `DESIGN.md` da raiz.
3. **Nenhuma exclusão sem clique.** A função de exclusão da limpeza só é chamada pela rota de execução da limpeza. Nenhum temporizador, nenhuma tarefa de inicialização e nenhum outro módulo a chama. As outras exclusões que esta spec cria (cópias de conflito, temporários esquecidos, arquivos de um perfil removido, foto de conta, imagem da marca d'água) têm cada uma a sua rota, sempre a partir de um clique. A **única** exclusão sem clique é a de temporários de JSON do próprio app, com alcance fechado ([architecture.md](./architecture.md), 6.2). A migração no mesmo disco, pedida pelo usuário, **move** arquivos; a saída do `video.info.json` da pasta de origem, no fim de cada vídeo e só depois de conferido o do destino, é parte dessa movimentação ([architecture.md](./architecture.md), 8.5).
4. **A limpeza só apaga dentro da pasta de vídeos**, arquivo por arquivo, por caminho reconstruído no servidor. Proibido `shutil.rmtree` no código da limpeza. São permitidas **exatamente duas** exclusões fora da pasta de vídeos, as duas de estado local do job de um vídeo que acabou de ser apagado, cada uma com teste próprio: `data/jobs/<job_id>/` (pela função nova `release_local_job_state`) e `data/jobs/<job_id>/audio_16k.wav`. A limpeza **não chama** o código de `DELETE /videos/:job_id` nem `delete_render_outputs` ([architecture.md](./architecture.md), 12.7).
5. **Segredo nunca toca a raiz, o log, uma resposta de rota nem um evento.** Token de renovação e credenciais do aplicativo: só no cofre do sistema. Token de acesso, código de autorização, `state` e verificador: só na memória. Endereço de sessão de envio: só em `data/publish/queue.json` (máquina), e só em memória se o diretório de dados parecer sincronizado. Nenhum deles vai em URL quando há alternativa, e nenhuma mensagem de erro é montada com o texto de uma exceção HTTP.
6. **Caminho absoluto nunca é gravado na raiz.** Dentro da raiz, só caminhos relativos, com `/`. E nenhum caminho é **montado** a partir de um campo lido de arquivo sincronizado: nomes de arquivo são fixos ou conferidos ([architecture.md](./architecture.md), 4.2 e 6.4). O único identificador sincronizado que vira nome de pasta é o `video_id` (`data/jobs/<video_id>/`), e só depois de conferido pelo formato de 32 hex; fora do formato, o arquivo conta como ilegível e nenhum job nasce dele ([architecture.md](./architecture.md), 5.3).
7. **Toda escrita de `.json` é atômica** (`write .tmp` + `fsync` + `os.replace`), e na raiz usa a função descrita em [architecture.md](./architecture.md), seção 6: trava por arquivo dentro do processo, temporário de nome único, novas tentativas e fusão. O registro de exclusões é só acréscimo e tem regra própria (12.8). Arquivo que existe e não pode ser lido **nunca** é sobrescrito.
8. **Serviço externo entra pelo container, com fake padrão**, no mesmo estilo de `folder_opener` e `llm_http_fetcher` (`backend/tests/conftest.py:48-98`). Nenhum teste abre conexão de rede.
9. **Interface: reuse antes de criar.** Componente novo só quando [ui.md](./ui.md) diz que ele não existe. Cores, raios e sombras vêm dos tokens. Nada de emoji, brilho, gradiente ou percentual na tela principal.
10. **Nunca afirme algo sobre YouTube ou TikTok que não esteja em [platforms.md](./platforms.md).** Se o código depender de algo marcado como "não confirmado", o comportamento precisa ser seguro nos dois casos e o item vai para [manual-validation.md](./manual-validation.md).
11. **Não toque em arquivos fora da lista da fase.** Se precisar, pare e registre em `decisions.md`. Os nomes de arquivo das listas das fases são os que valem; [ui.md](./ui.md), 0.3, repete os mesmos.
12. **Não rode `git commit`, `git push`, nem crie conta, aplicativo de desenvolvedor ou login em serviço nenhum.** Isso é do dono.
13. **A identidade de um vídeo nunca é adivinhada nem trocada sozinha.** Em modo raiz, uma pasta sem arquivo de informações que esta máquina ainda não conhecia não é adotada sem clique. Um arquivo de informações ilegível nunca faz nascer um job. Um `video_id` repetido não é regravado sozinho em modo raiz. Uma pasta tem um job só. Renomear nunca move uma pasta para dentro de outra. A migração grava o arquivo de informações no destino **antes** dos arquivos de vídeo, e é por ele que a retomada acha a pasta. A limpeza só dá um vídeo como acabado pelo que o arquivo de informações diz, não pela falta de arquivos no disco ([architecture.md](./architecture.md), 8.2, 8.3, 8.5 e 12.7).

## Modelos por tipo de trabalho

| Trabalho | Modelo |
|---|---|
| Orquestração e decisões entre fases | Fable (sessão) |
| Mapear código, localizar usos | Haiku |
| Implementar com especificação fechada, testes mockados | Sonnet |
| Revisão independente de cada fase | Opus |

Um workflow por fase, com poucos agentes. Backend e frontend da mesma fase podem andar em paralelo depois que os contratos da fase estiverem escritos em `shared/contracts.ts`.
