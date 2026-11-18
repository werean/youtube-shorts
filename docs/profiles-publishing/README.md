# Perfis, marca d'água, publicação e limpeza — Plano (rascunho)

Registro do que foi decidido em conversa com o dono do projeto em 18/11/2026. **Nada disto está implementado.** Este arquivo é um plano, não uma especificação: antes de implementar ele vira uma spec com fases e critérios de pronto, nos moldes de [`docs/analysis-v2/`](../analysis-v2/README.md).

## O que se quer

1. Marca d'água do usuário nos vídeos gerados.
2. Contas do YouTube e do TikTok ligadas ao app, para publicar os cortes aprovados.
3. Várias contas de cada plataforma, com vídeos e preferências separados por conta.
4. Pasta escolhida pelo usuário para vídeos e preferências, inclusive um disco sincronizado (Google Drive), de modo que o app abra igual em outro computador ao apontar para a mesma pasta.
5. Limpeza de vídeos antigos e limite de tamanho da pasta.

## Decisões tomadas

### Marca d'água

- O usuário envia a imagem e escolhe o nível de transparência.
- Três modos: adicionar em todos os vídeos, não adicionar em nenhum, perguntar antes.
- A marca d'água é uma preferência do perfil.

### Contas e perfis

- É possível ligar várias contas do YouTube e várias do TikTok.
- Vídeos e preferências ficam separados por conta.
- A conta (pelo ID fixo dela na plataforma) é o que identifica a quem pertencem os dados na pasta.
- Ver e editar não exige login. O login só é exigido para publicar.
- Quem usa YouTube e TikTok para o mesmo conteúdo pode enviar o mesmo corte para os dois: na hora de publicar, o usuário escolhe os destinos.
- Suposição a confirmar: para isso funcionar com vídeos separados por conta, as contas que recebem o mesmo conteúdo ficam agrupadas num mesmo perfil. As preferências (marca d'água incluída) e os vídeos são do perfil; cada perfil pode ter contas das duas plataformas ligadas a ele.

### Pasta portátil

- O usuário escolhe onde ficam os vídeos e onde ficam as preferências e contas.
- **Vai para a pasta (viaja entre computadores):**
  - vídeos já baixados;
  - cortes já gerados;
  - preferências de cada conta;
  - um arquivo pequeno de informações ao lado de cada vídeo, com título, link de origem, data de download e onde já foi publicado. Serve para o segundo computador não enxergar só arquivos soltos e não publicar duas vezes o mesmo corte.
- **Não vai para a pasta:**
  - estado em andamento: transcrição, análise e cortes ainda não aprovados. No segundo computador, um vídeo baixado aparece como "baixado" e o processamento é refeito ali;
  - modelos de IA e dependências: cada computador baixa os seus;
  - configuração da máquina: modelo em uso, GPU ou CPU, caminhos locais;
  - credenciais: os tokens das contas ficam só em cada computador. Em um computador novo o usuário faz login de novo.
- Quem leva os dados de um computador para o outro é a pasta sincronizada. As plataformas não guardam preferências nem cortes do app, e não haverá servidor próprio.

### Limpeza

- Duas regras configuráveis: idade máxima do vídeo (exemplo: 30 dias) e tamanho máximo da pasta de vídeos (exemplo: 50 GB), removendo os mais antigos primeiro.
- A data que conta é a **data de download** gravada pelo app, não a data do arquivo.
- A exclusão é **definitiva**, sem passar pela lixeira.
- A exclusão **não é automática**: o usuário precisa clicar. Uma notificação na barra lateral informa quantos itens estão para ser excluídos e pergunta se deseja excluir agora.
- **Ao atingir o limite de tamanho**, o app emite um aviso e pergunta se o usuário deseja apagar ou adiar. Adiar vale por um dia; depois disso o aviso volta.
  - Suposição a confirmar: ao adiar, o download ou a renderização que causou o aviso segue em frente, e a pasta fica acima do limite até o usuário apagar.
- **Ordem de exclusão:** primeiro os vídeos de origem, dos mais antigos para os mais novos. Os cortes só entram depois.
- Proteções:
  - desligado por padrão;
  - antes de excluir, mostrar a lista do que será apagado e pedir confirmação;
  - nunca apagar um vídeo que está sendo processado;
  - registrar em log o que foi apagado e por qual regra;
  - cortes aprovados e ainda não publicados aparecem destacados na notificação, e deve ser possível marcar um vídeo como "manter";
  - arquivos enviados do computador do usuário entram marcados como "manter" por padrão e só entram na limpeza se o usuário desmarcar. O motivo: o app pode mover o arquivo original para a pasta dele (`move_uploads`), e aí essa é a única cópia; um vídeo do YouTube pode ser baixado de novo;
  - se um único vídeo for maior que o limite configurado, avisar e perguntar se o usuário deseja abrir uma exceção. Com a exceção, o vídeo é baixado e **não é contabilizado** no limite de tamanho. Sem a exceção, o vídeo não é baixado.
- Sobre a exceção de tamanho:
  - o uso real do disco pode passar do limite configurado; a tela deve mostrar os dois números, o total contabilizado e o total com exceções;
  - a exceção fica gravada no arquivo de informações do vídeo, para valer também no outro computador;
  - suposição a confirmar: a exceção vale só para a conta do tamanho. O vídeo continua sujeito à regra de idade, a menos que esteja marcado como "manter".

## O que se sabe sobre as plataformas

Levantado em pesquisa em 18/11/2026, em boa parte a partir de blogs. **Conferir na documentação oficial antes de escrever a spec.**

- **YouTube:** o envio pela API oficial funciona, mas vídeos enviados por um projeto de API não verificado, criado depois de julho de 2020, ficam restritos a privado até o projeto passar por auditoria. As fontes divergem sobre o limite diário de envios. Cada usuário precisaria criar o próprio projeto no Google Cloud, o que é gratuito.
- **TikTok:** sem auditoria do aplicativo, todo conteúdo publicado sai privado. Fontes de terceiros falam em limite de 5 usuários por dia e em exigência de conta privada no momento do envio. Existe um caminho de rascunho, que manda o vídeo para a caixa de entrada do TikTok; não foi confirmado se ele sofre a mesma restrição.
- **Caminho sugerido:** começar enviando como privado ou rascunho, e decidir depois se vale pedir a auditoria.

## Perguntas em aberto

1. **Perfil agrupando contas:** confirmar a suposição registrada em "Contas e perfis".
2. **Adiar o aviso de limite:** confirmar a suposição de que a operação segue em frente e a pasta fica acima do limite durante o adiamento.
3. **Arquivos enviados do computador e o limite de tamanho.** Decidido que entram protegidos por padrão. Falta definir se, estando protegidos, eles contam ou não para o limite de tamanho da pasta. Se contarem, uma pasta cheia de arquivos protegidos atinge o limite sem ter o que apagar.
4. **Exceção de tamanho e regra de idade:** confirmar a suposição registrada em "Limpeza".
5. **Pasta no Drive:** apagar ali apaga em todos os computadores, e o Drive pode manter o arquivo na lixeira dele. Avisar o usuário na tela de configuração?
6. **Dois computadores abertos ao mesmo tempo** na mesma pasta: basta uma trava de "um por vez"?
7. **Posição e tamanho da marca d'água:** fixos ou configuráveis?
8. **Publicação:** título, descrição e hashtags vêm de onde? O título sugerido pelo corte, editável antes de enviar?

## Impacto no projeto

- Rotas novas; as existentes não mudam.
- Bastante trabalho de frontend, que é de outra sessão.
- A configuração atual mistura preferências do usuário e configuração da máquina no mesmo arquivo; será preciso separar as duas.
- Os jobs guardam hoje o caminho completo do vídeo; o que for para a pasta portátil precisa usar caminho relativo.
- A premissa de IA local e custo zero se mantém: as APIs de publicação são gratuitas e opcionais.

## Ordem sugerida

1. Marca d'água.
2. Pasta portátil, com a separação entre preferências do perfil e configuração da máquina, e o arquivo de informações por vídeo.
3. Contas e perfis.
4. Limpeza, com a notificação.
5. Publicação no YouTube.
6. Publicação no TikTok.
