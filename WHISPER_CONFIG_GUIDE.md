# 🎙️ Configuração Completa do Whisper

A interface de configuração do Whisper agora suporta **TODAS as funcionalidades** do comando `whisper --help`, organizadas em 8 seções principais com tooltips e descrições:

## Seções Implementadas

### 1. 📦 **Modelo**

- `model` - Selecione entre: Turbo, Large, Medium, Small, Base, Tiny
- `model_dir` - Caminho customizado para salvar/carregar modelos

### 2. 💾 **Dispositivo e Saída**

- `device` - CPU ou CUDA (GPU NVIDIA)
- `output_dir` - Diretório onde salvar transcrições
- `output_format` - Múltiplos formatos: JSON, VTT, TXT, SRT, TSV, Todos

### 3. ⚡ **Opções Básicas**

- `verbose` - Mostrar mensagens de progresso e debug
- `task` - Transcrever ou traduzir para inglês
- `language` - 70+ idiomas suportados (ou auto-detecção)
- `temperature` - Controlar nível de aleatoriedade (0.0 - 1.0)

### 4. 🔍 **Busca e Amostragem**

- `best_of` - Número de candidatos com temperatura > 0
- `beam_size` - Número de beams para beam search
- `patience` - Parâmetro de paciência
- `length_penalty` - Penalidade de comprimento de token

### 5. 💬 **Token e Prompt**

- `suppress_tokens` - IDs de tokens para suprimir
- `initial_prompt` - Texto inicial para primeira janela
- `carry_initial_prompt` - Manter prompt em cada decode
- `condition_on_previous_text` - Usar saída anterior como prompt

### 6. 🧠 **Decodificação Avançada**

- `fp16` - Inferência em 16-bit (mais rápido)
- `temperature_increment_on_fallback` - Aumentar temp em falha
- `compression_ratio_threshold` - Limiar de compressão gzip
- `logprob_threshold` - Limiar de probabilidade logarítmica
- `no_speech_threshold` - Detectar segmentos em silêncio

### 7. ⏱️ **Timestamps e Palavras** (Seção Expansível)

- `word_timestamps` - Extrair timestamps por palavra (experimental)
- `prepend_punctuations` - Símbolos para mesclar com próxima palavra
- `append_punctuations` - Símbolos para mesclar com palavra anterior
- `highlight_words` - Sublinhar palavras em SRT/VTT

### 8. 📝 **Formatação de Saída** (Aparece quando word_timestamps ativado)

- `max_line_width` - Máximo de caracteres por linha
- `max_line_count` - Máximo de linhas por segmento
- `max_words_per_line` - Máximo de palavras por linha

### 9. ⚙️ **Performance**

- `threads` - Número de threads para CPU inference
- `clip_timestamps` - Timestamps de clipes específicos
- `hallucination_silence_threshold` - Ignorar silêncio em alucinações

## Recursos de UX

✨ **Cada campo inclui:**

- ✋ Tooltip explicativo (ícone `?`) com descrição detalhada
- 📝 Descrição em português dos parâmetros
- 🎯 Valores padrão indicados
- 🔀 Campos condicionales (aparecem quando necessário)

✨ **Componentes reutilizáveis:**

- `TextInput` - Campos de texto e número
- `TextArea` - Campos multilinha
- `SelectInput` - Dropdowns com opções
- `Toggle` - Switches on/off
- `MultiSelect` - Seleção múltipla com grid
- `ConfigSection` - Seções expansíveis/colapsáveis

## Arquivos Criados

- `frontend/src/types/whisper.ts` (344 linhas)
  - Interface `WhisperConfig` com todas as opções
  - Constantes `WHISPER_MODELS`, `WHISPER_LANGUAGES`, `WHISPER_OUTPUT_FORMATS`
  - Definições de campos com tooltips e descrições

- `frontend/src/components/WhisperConfigComponents.tsx` (270 linhas)
  - Componentes auxiliares reutilizáveis
  - `Tooltip` - Sistema de tooltips hover
  - `ConfigField` - Container com label, descrição e tooltip
  - `TextInput`, `TextArea`, `SelectInput`, `Toggle`, `MultiSelect`
  - `ConfigSection` - Seções expansíveis

- `frontend/src/components/WhisperConfigDialog.tsx` (583 linhas)
  - Dialog completo com todas as 9 seções
  - Estados para todos os 25+ parâmetros
  - Renderização condicional de seções
  - Validação básica e conversão de types

## Próximas Etapas (Backend)

Para usar completamente todas as configurações no backend:

1. Expandir modelo de settings para armazenar todos os parâmetros Whisper
2. Atualizar comando Whisper em `backend/src/pipeline/transcription.ts`:
   ```bash
   whisper "${videoPath}" \
     --model ${config.WHISPER_MODEL} \
     --device ${config.WHISPER_DEVICE} \
     --output_format ${config.WHISPER_FORMATS} \
     --task ${config.WHISPER_TASK} \
     --language ${config.WHISPER_LANGUAGE} \
     --temperature ${config.WHISPER_TEMPERATURE} \
     ... (e mais 20 opções)
   ```
3. Salvar configurações em `data/settings.json`
4. Recuperar e aplicar ao transcrever

## Compatibilidade

✅ Interface mantém compatibilidade com versão anterior

- `onSave(device, formats)` funciona como antes
- Configurações adicionais podem ser integradas no backend gradualmente
- Sem breaking changes na props do diálogo
