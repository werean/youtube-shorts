/**
 * Tipos e configurações completas para Whisper
 * Baseado em: whisper --help
 */

export interface WhisperConfig {
  // Model options
  model: "turbo" | "large-v3" | "large" | "medium" | "small" | "base" | "tiny";
  model_dir?: string;

  // Device & Output
  device: "cpu" | "cuda";
  output_dir?: string;
  output_format: ("txt" | "vtt" | "srt" | "tsv" | "json" | "all")[];

  // Basic options
  verbose: boolean;
  task: "transcribe" | "translate";
  language?: string;
  temperature: string | number;

  // Search & Sampling
  best_of: string | number;
  beam_size: string | number;
  patience?: number;
  length_penalty?: number;

  // Token & Prompt
  suppress_tokens?: string;
  initial_prompt?: string;
  carry_initial_prompt: boolean;
  condition_on_previous_text: boolean;

  // Advanced Decoding
  fp16: boolean;
  temperature_increment_on_fallback: string | number;
  compression_ratio_threshold: string | number;
  logprob_threshold: string | number;
  no_speech_threshold: string | number;

  // Timestamp & Word options
  word_timestamps: boolean;
  prepend_punctuations?: string;
  append_punctuations?: string;
  highlight_words: boolean;

  // Output formatting
  max_line_width?: number;
  max_line_count?: number;
  max_words_per_line?: number;

  // Performance
  threads: string | number;
  clip_timestamps?: string;
  hallucination_silence_threshold?: number;
}

export interface WhisperModelSpec {
  id: "turbo" | "large-v3" | "large" | "medium" | "small" | "base" | "tiny";
  label: string;
  description: string;
  size: string; // Tamanho do modelo em MB ou B (parâmetros)
  vram_required: string; // VRAM GPU estimada
  ram_required: string; // RAM sistema estimada
  quality: number; // 1-5 (5 = melhor qualidade)
  speed: number; // 1-5 (5 = mais rápido)
  time_1h_audio: string; // Tempo estimado para processar 1h de áudio
  recommended_use: string; // Caso de uso recomendado
}

export const WHISPER_MODELS: WhisperModelSpec[] = [
  {
    id: "large-v3",
    label: "Large v3",
    description: "Maior precisão, padrão atual",
    size: "1.5B parâmetros",
    vram_required: "10 GB",
    ram_required: "6-8 GB",
    quality: 5,
    speed: 2,
    time_1h_audio: "20-30 min",
    recommended_use: "Máxima qualidade quando GPU é disponível",
  },
  {
    id: "turbo",
    label: "Turbo",
    description: "Rápido com ótima qualidade",
    size: "256M parâmetros",
    vram_required: "6 GB",
    ram_required: "4-6 GB",
    quality: 4,
    speed: 4,
    time_1h_audio: "5-8 min",
    recommended_use: "Balanceado: qualidade e velocidade, ideal para uso em produção",
  },
  {
    id: "large",
    label: "Large",
    description: "Máxima qualidade",
    size: "1.5B parâmetros",
    vram_required: "10 GB",
    ram_required: "6-8 GB",
    quality: 5,
    speed: 2,
    time_1h_audio: "20-30 min",
    recommended_use: "Qualidade máxima quando desempenho não é crítico",
  },
  {
    id: "medium",
    label: "Medium",
    description: "Equilibrado entre velocidade e qualidade",
    size: "769M parâmetros",
    vram_required: "5 GB",
    ram_required: "4-6 GB",
    quality: 4,
    speed: 3,
    time_1h_audio: "10-15 min",
    recommended_use: "Bom equilíbrio para a maioria dos casos",
  },
  {
    id: "small",
    label: "Small",
    description: "Pequeno e rápido",
    size: "244M parâmetros",
    vram_required: "2 GB",
    ram_required: "2-4 GB",
    quality: 3,
    speed: 4,
    time_1h_audio: "8-12 min",
    recommended_use: "Performance aceitável com recursos limitados",
  },
  {
    id: "base",
    label: "Base",
    description: "Modelo base, compacto",
    size: "74M parâmetros",
    vram_required: "1 GB",
    ram_required: "2-3 GB",
    quality: 2,
    speed: 5,
    time_1h_audio: "5-8 min",
    recommended_use: "Máxima velocidade, qualidade reduzida",
  },
  {
    id: "tiny",
    label: "Tiny",
    description: "Mínimo e super rápido",
    size: "39M parâmetros",
    vram_required: "512 MB",
    ram_required: "1-2 GB",
    quality: 1,
    speed: 5,
    time_1h_audio: "3-5 min",
    recommended_use: "Testes rápidos ou CPU-only com hardware muito limitado",
  },
] as const;

export const WHISPER_LANGUAGES = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "ba",
  "be",
  "bg",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fo",
  "fr",
  "gl",
  "gu",
  "ha",
  "haw",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jw",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "la",
  "lb",
  "ln",
  "lo",
  "lt",
  "lv",
  "mg",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "nn",
  "no",
  "oc",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sa",
  "sd",
  "si",
  "sk",
  "sl",
  "sn",
  "so",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tk",
  "tl",
  "tr",
  "tt",
  "uk",
  "ur",
  "uz",
  "vi",
  "yi",
  "yo",
  "yue",
  "zh",
  // Full names
  "Afrikaans",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Assamese",
  "Azerbaijani",
  "Bashkir",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bosnian",
  "Breton",
  "Bulgarian",
  "Burmese",
  "Cantonese",
  "Castilian",
  "Catalan",
  "Chinese",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Estonian",
  "Faroese",
  "Finnish",
  "Flemish",
  "French",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Gujarati",
  "Haitian",
  "Haitian Creole",
  "Hausa",
  "Hawaiian",
  "Hebrew",
  "Hindi",
  "Hungarian",
  "Icelandic",
  "Indonesian",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kazakh",
  "Khmer",
  "Korean",
  "Lao",
  "Latin",
  "Latvian",
  "Letzeburgesch",
  "Lingala",
  "Lithuanian",
  "Luxembourgish",
  "Macedonian",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Mandarin",
  "Maori",
  "Marathi",
  "Moldavian",
  "Moldovan",
  "Mongolian",
  "Myanmar",
  "Nepali",
  "Norwegian",
  "Nynorsk",
  "Occitan",
  "Panjabi",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Pushto",
  "Romanian",
  "Russian",
  "Sanskrit",
  "Serbian",
  "Shona",
  "Sindhi",
  "Sinhala",
  "Sinhalese",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tagalog",
  "Tajik",
  "Tamil",
  "Tatar",
  "Telugu",
  "Thai",
  "Tibetan",
  "Turkish",
  "Turkmen",
  "Ukrainian",
  "Urdu",
  "Uzbek",
  "Valencian",
  "Vietnamese",
  "Welsh",
  "Yiddish",
  "Yoruba",
] as const;

export const WHISPER_OUTPUT_FORMATS = [
  { id: "json", label: "JSON", description: "Formato JSON com segmentos detalhados e timestamps" },
  { id: "vtt", label: "VTT", description: "WebVTT - formato de legendas para web players" },
  { id: "txt", label: "TXT", description: "Texto simples sem timestamps" },
  { id: "srt", label: "SRT", description: "SubRip - formato de legendas universal" },
  { id: "tsv", label: "TSV", description: "Tab-separated values com detalhes de transcrição" },
  { id: "all", label: "Todos", description: "Gera todos os formatos acima" },
] as const;

export const WHISPER_CONFIG_FIELDS = {
  // Model section
  model: {
    label: "Modelo",
    type: "select" as const,
    description: "Selecione o modelo Whisper a usar",
    tooltip:
      "Diferentes tamanhos de modelos com trade-offs entre qualidade e velocidade. Turbo é mais rápido, Large é mais preciso.",
    default: "turbo",
  },
  model_dir: {
    label: "Diretório de modelos",
    type: "text" as const,
    description: "Caminho para salvar arquivos de modelo",
    tooltip: "Por padrão usa ~/.cache/whisper. Deixe em branco para usar o padrão.",
    default: "",
  },

  // Device & Output section
  device: {
    label: "Dispositivo",
    type: "select" as const,
    description: "CPU (mais compatível) ou CUDA (mais rápido em NVIDIA GPUs)",
    tooltip: "CUDA é muito mais rápido se tiver GPU NVIDIA. CPU é mais compatível.",
    default: "cuda",
  },
  output_dir: {
    label: "Diretório de saída",
    type: "text" as const,
    description: "Onde salvar os arquivos transcritos",
    tooltip: "O diretório onde as transcrições serão salvas. Deixe vazio para diretório atual.",
    default: "",
  },
  output_format: {
    label: "Formatos de saída",
    type: "multi-select" as const,
    description: "Escolha os formatos desejados",
    tooltip:
      "Você pode gerar múltiplos formatos simultaneamente. 'Todos' gera todos os 5 formatos.",
    default: ["all"],
  },

  // Basic options section
  verbose: {
    label: "Modo verbose",
    type: "toggle" as const,
    description: "Mostrar mensagens de progresso e debug",
    tooltip: "Exibir saída de progresso e mensagens de debug durante a transcrição.",
    default: true,
  },
  task: {
    label: "Tarefa",
    type: "select" as const,
    description: "Transcrição ou tradução para inglês",
    tooltip:
      "Transcrição: converte fala para texto no idioma original. Tradução: converte para texto em inglês.",
    default: "transcribe",
  },
  language: {
    label: "Idioma",
    type: "select" as const,
    description: "Idioma do áudio (deixe vazio para auto-detecção)",
    tooltip:
      "Especifique o idioma falado no áudio para melhor precisão. Deixe vazio para detecção automática.",
    default: "",
  },
  temperature: {
    label: "Temperatura",
    type: "number" as const,
    description: "Temperatura para amostragem (0.0 - 1.0)",
    tooltip:
      "Valores menores (0) são mais determinísticos. Valores maiores (1) são mais criativos/aleatórios. Padrão: 0",
    default: 0,
    min: 0,
    max: 1,
  },

  // Search & Sampling section
  best_of: {
    label: "Best of",
    type: "number" as const,
    description: "Número de candidatos com temperatura não-zero",
    tooltip: "Número de candidatos de decodificação quando temperatura > 0. Padrão: 5",
    default: 5,
    min: 1,
  },
  beam_size: {
    label: "Tamanho do beam",
    type: "number" as const,
    description: "Número de beams em busca em feixe",
    tooltip: "Número de beams em beam search (usado quando temperatura = 0). Padrão: 5",
    default: 5,
    min: 1,
  },
  patience: {
    label: "Patience",
    type: "number" as const,
    description: "Valor de paciência para decodificação de beam",
    tooltip: "Parâmetro de paciência para beam search. Deixe vazio para usar padrão (1.0).",
    default: undefined,
    min: 0.1,
  },
  length_penalty: {
    label: "Penalidade de comprimento",
    type: "number" as const,
    description: "Coeficiente de penalidade de comprimento (alpha)",
    tooltip:
      "Penalidade aplicada ao comprimento do token. Deixe vazio para usar normalizador de comprimento simples.",
    default: undefined,
  },

  // Token & Prompt section
  suppress_tokens: {
    label: "Suprimir tokens",
    type: "text" as const,
    description: "Lista separada por vírgula de IDs de tokens para suprimir",
    tooltip:
      "IDs de tokens a suprimir durante amostragem. Use '-1' para suprimir caracteres especiais. Padrão: -1",
    default: "-1",
  },
  initial_prompt: {
    label: "Prompt inicial",
    type: "textarea" as const,
    description: "Texto para usar como prompt para a primeira janela",
    tooltip:
      "Texto opcional fornecido como prompt para a primeira janela de decodificação. Melhora a coerência.",
    default: "",
  },
  carry_initial_prompt: {
    label: "Manter prompt inicial",
    type: "toggle" as const,
    description: "Antecer prompt inicial a cada chamada interna de decode()",
    tooltip:
      "Se verdadeiro, prepend prompt inicial a cada decodificação interna. Pode reduzir a eficácia de 'condition_on_previous_text'.",
    default: false,
  },
  condition_on_previous_text: {
    label: "Condicionar em texto anterior",
    type: "toggle" as const,
    description: "Usar saída anterior como prompt para próxima janela",
    tooltip:
      "Se verdadeiro, usa saída anterior como prompt. Se falso, texto menos consistente mas menos propenso a falhas repetidas.",
    default: true,
  },

  // Advanced Decoding section
  fp16: {
    label: "FP16",
    type: "toggle" as const,
    description: "Executar inferência em precisão 16-bit",
    tooltip:
      "Usar ponto flutuante de 16 bits para inferência. Mais rápido e usa menos memória. Padrão: verdadeiro.",
    default: true,
  },
  temperature_increment_on_fallback: {
    label: "Incremento de temperatura em fallback",
    type: "number" as const,
    description: "Temperatura a aumentar quando decodificação falha",
    tooltip:
      "Quanto aumentar a temperatura quando a decodificação falha em atender aos limites. Padrão: 0.2",
    default: 0.2,
    min: 0,
    max: 1,
  },
  compression_ratio_threshold: {
    label: "Limiar de razão de compressão",
    type: "number" as const,
    description: "Limiar de razão de compressão gzip",
    tooltip:
      "Se a razão de compressão gzip for maior que este valor, trata a decodificação como falha. Padrão: 2.4",
    default: 2.4,
    min: 1,
  },
  logprob_threshold: {
    label: "Limiar de logprob",
    type: "number" as const,
    description: "Limiar de probabilidade logarítmica média",
    tooltip:
      "Se a probabilidade log média for menor que este valor, trata como falha. Padrão: -1.0",
    default: -1.0,
  },
  no_speech_threshold: {
    label: "Limiar sem fala",
    type: "number" as const,
    description: "Limiar para detectar segmentos em silêncio",
    tooltip: "Se probabilidade do token <|nospeech|> for maior, trata como silêncio. Padrão: 0.6",
    default: 0.6,
    min: 0,
    max: 1,
  },

  // Timestamp & Word options section
  word_timestamps: {
    label: "Timestamps de palavras",
    type: "toggle" as const,
    description: "Extrair timestamps no nível de palavra (experimental)",
    tooltip:
      "Extrai timestamps para cada palavra individualmente. Permite refinar resultados com base em timing de palavras.",
    default: false,
  },
  prepend_punctuations: {
    label: "Pontuações prepend",
    type: "text" as const,
    description: "Símbolos de pontuação para mesclar com próxima palavra",
    tooltip:
      "Se word_timestamps é ativo, estes símbolos são mesclados com a próxima palavra. Padrão: \"'¿([{-",
    default: "\"'¿([{-",
  },
  append_punctuations: {
    label: "Pontuações append",
    type: "text" as const,
    description: "Símbolos de pontuação para mesclar com palavra anterior",
    tooltip:
      'Se word_timestamps é ativo, estes símbolos são mesclados com a palavra anterior. Padrão: "\'.。,，!！?？:：")]}、',
    default: '"\'.。,，!！?？:：")]}、',
  },
  highlight_words: {
    label: "Destacar palavras",
    type: "toggle" as const,
    description: "Sublinhar cada palavra conforme é falada em srt/vtt",
    tooltip:
      "Requer word_timestamps ativado. Sublinha cada palavra nos arquivos SRT/VTT conforme é falada.",
    default: false,
  },

  // Output formatting section
  max_line_width: {
    label: "Largura máxima de linha",
    type: "number" as const,
    description: "Máximo de caracteres por linha de legenda",
    tooltip:
      "Requer word_timestamps. Número máximo de caracteres antes de quebrar linha. Deixe vazio para sem limite.",
    default: undefined,
    min: 20,
  },
  max_line_count: {
    label: "Máximo de linhas",
    type: "number" as const,
    description: "Máximo de linhas por segmento",
    tooltip:
      "Requer word_timestamps. Número máximo de linhas por segmento. Deixe vazio para sem limite.",
    default: undefined,
    min: 1,
  },
  max_words_per_line: {
    label: "Máximo de palavras por linha",
    type: "number" as const,
    description: "Máximo de palavras por linha (sem efeito com max_line_width)",
    tooltip:
      "Requer word_timestamps e sem max_line_width. Número máximo de palavras por linha. Deixe vazio para sem limite.",
    default: undefined,
    min: 1,
  },

  // Performance section
  threads: {
    label: "Threads",
    type: "number" as const,
    description: "Número de threads para CPU inference",
    tooltip:
      "Número de threads do PyTorch para CPU inference. Sobrescreve MKL_NUM_THREADS/OMP_NUM_THREADS. Padrão: 0 (auto)",
    default: 0,
    min: 0,
  },
  clip_timestamps: {
    label: "Corte de timestamps",
    type: "text" as const,
    description: "Timestamps de clipes: start,end,start,end,... (em segundos)",
    tooltip:
      "Lista separada por vírgula de start,end,start,end... para processar apenas clipes específicos. Último end é opcional.",
    default: "0",
  },
  hallucination_silence_threshold: {
    label: "Limiar de alucinação-silêncio",
    type: "number" as const,
    description: "Ignorar períodos de silêncio maiores que este limiar",
    tooltip:
      "Requer word_timestamps. Duração em segundos de silêncio para pular quando alucinação é detectada.",
    default: undefined,
    min: 0,
  },
} as const;
