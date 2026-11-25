export const GITHUB_REPO = "werean/youtube-shorts";
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const GITHUB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const BROWSER_DEV_VERSION = "Modo navegador (dev)";

export interface AppVersionInfo {
  currentVersion: string;
  isPortable: boolean;
  repo: string;
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  canAutoUpdate: boolean;
  status: string;
  message: string;
}

type TauriInvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvokeFn;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvokeFn;
  };
};

function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as TauriWindow;
  const invoke = win.__TAURI__?.core?.invoke ?? win.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke : null;
}

export function isTauriRuntime(): boolean {
  return getTauriInvoke() !== null;
}

export async function getAppVersionInfo(): Promise<AppVersionInfo> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return invoke<AppVersionInfo>("get_app_version_info");
  }
  return {
    currentVersion: BROWSER_DEV_VERSION,
    isPortable: false,
    repo: GITHUB_REPO,
  };
}

interface GitHubLatestReleasePayload {
  tag_name?: string;
  html_url?: string;
}

export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  const invoke = getTauriInvoke();
  if (invoke) {
    return invoke<AppUpdateInfo>("check_for_app_update");
  }

  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Não foi possível consultar o GitHub (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as GitHubLatestReleasePayload;
  const latestVersion =
    typeof payload.tag_name === "string" && payload.tag_name.trim()
      ? payload.tag_name.trim()
      : null;
  const releaseUrl =
    typeof payload.html_url === "string" && payload.html_url.trim()
      ? payload.html_url.trim()
      : GITHUB_RELEASES_URL;

  return {
    currentVersion: BROWSER_DEV_VERSION,
    latestVersion,
    updateAvailable: false,
    releaseUrl,
    canAutoUpdate: false,
    status: "browser_dev",
    message: latestVersion
      ? `Última release no GitHub: ${latestVersion}. A atualização automática funciona apenas no aplicativo portátil (youtube-shorts.exe).`
      : "Nenhuma tag de release foi encontrada no GitHub. A atualização automática funciona apenas em youtube-shorts.exe.",
  };
}

export async function installAppUpdate(): Promise<string> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error(
      "A atualização automática está disponível apenas no aplicativo portátil (youtube-shorts.exe).",
    );
  }
  return invoke<string>("install_app_update");
}
