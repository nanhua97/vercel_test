import { ProxyAgent, setGlobalDispatcher } from 'undici';

let proxyApplied = false;

function isDevEnvironment(): boolean {
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();

  if (appEnv === 'dev' || appEnv === 'development') {
    return true;
  }

  if (appEnv === 'prod' || appEnv === 'production') {
    return false;
  }

  return nodeEnv !== 'production';
}

function getProxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    null
  );
}

export function setupDevProxyForGemini(): void {
  if (proxyApplied || !isDevEnvironment()) {
    return;
  }

  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  proxyApplied = true;
  console.log(`[dev-proxy] Enabled global fetch proxy for Gemini via ${proxyUrl}`);
}
