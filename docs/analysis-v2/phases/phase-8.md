# Fase 8 — Cortes não contínuos (opcional)

> Detalhamento resumido. É a mudança de maior risco e a única que exige trabalho no frontend. Só começa por decisão explícita do dono do projeto.

## Objetivo

Permitir que um corte seja uma lista de trechos, para remover uma digressão do meio ou abrir com a frase mais forte, como um editor faria.

## Depende de

- Fase 4 concluída.
- Coordenação com a sessão de frontend.
- Evidência do harness de que o ganho existe: contar, em `candidates.scored.json`, quantos candidatos com `interest ≥ 4` foram rejeitados só por conter um trecho `non_content` ou uma digressão no meio. Se forem poucos, a fase não compensa.

## Desenho

- `Cut` ganha campo opcional `segments: [{start, end}]`. `start` e `end` do corte continuam existindo e cobrem o intervalo total, para o que já lê esses campos seguir funcionando.
- Sem `segments`, o corte é contínuo, como hoje.
- Uma etapa nova depois de S5 pergunta ao LLM, com IDs de frase restritos, quais frases internas podem sair sem quebrar o raciocínio. Reordenar trechos fica fora da primeira versão.
- O corte editado é pontuado de novo em S4. Só substitui o contínuo se a nota subir.
- A renderização concatena os trechos; legendas e enquadramento passam a mapear o tempo do corte editado.

## Impacto fora da análise

- `shared/contracts.ts`: campo novo, opcional.
- Frontend: player de pré-visualização e editor de corte precisam entender `segments`.
- `domain/rendering/`: filtro de concatenação, legendas `.ass` e trajetória do enquadramento por trecho.

## Critério de pronto

1. Com `segments` ausente, nada muda em nenhuma métrica nem na renderização.
2. A taxa do juiz sobe nos cortes editados em relação às versões contínuas dos mesmos cortes.
3. Nenhuma emenda cai no meio de uma frase.
4. Verificação visual, pelo dono, de que as emendas não ficam bruscas em pelo menos 10 cortes renderizados.

## Modelos

Desenho e prompts: Fable. Implementação: Sonnet. Revisão: Opus.
