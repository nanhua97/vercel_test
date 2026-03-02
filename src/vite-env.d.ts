/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QWEN_API_KEY?: string;
  readonly VITE_QWEN_BASE_URL?: string;
  readonly VITE_QWEN_MODEL?: string;
  readonly VITE_QWEN_MAX_OUTPUT_TOKENS?: string;
  readonly VITE_QWEN_REQUEST_TIMEOUT_MS?: string;
  readonly VITE_QWEN_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
