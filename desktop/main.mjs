import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol, shell } from "electron";

const APP_ID = "com.aprisyourlie.koin";
const APP_SCHEME = "koin";
const APP_ORIGIN = "koin://app";
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = app.isPackaged ? resolve(process.resourcesPath, "app.asar.unpacked") : resolve(currentDirectory, "..");
const assetRoot = resolve(projectRoot, "dist");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName("Koin");
app.setAppUserModelId(APP_ID);

function safeAssetPath(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const relativePath = (pathname === "/" ? "index.html" : pathname).replace(/^[/\\]+/, "");
  const candidate = resolve(assetRoot, relativePath);
  if (candidate !== assetRoot && !candidate.startsWith(`${assetRoot}${sep}`)) return null;
  return candidate;
}

async function fetchAsset(request, allowIndexFallback = true) {
  let assetPath = safeAssetPath(request.url);
  if (!assetPath) return new Response("Forbidden", { status: 403 });

  try {
    if ((await stat(assetPath)).isDirectory()) assetPath = join(assetPath, "index.html");
    const body = await readFile(assetPath);
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": assetPath.includes(`${sep}_next${sep}static${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
        "content-type": contentTypes[extname(assetPath).toLowerCase()] ?? "application/octet-stream",
      },
    });
  } catch {
    if (allowIndexFallback && !extname(assetPath)) {
      return fetchAsset(new Request(`${APP_ORIGIN}/index.html`), false);
    }
    return new Response("Not found", { status: 404 });
  }
}

async function registerKoinProtocol() {
  protocol.handle(APP_SCHEME, fetchAsset);
}

function createWindow() {
  const window = new BrowserWindow({
    title: "Koin",
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f4f1ea",
    show: false,
    autoHideMenuBar: true,
    ...(app.isPackaged ? {} : { icon: join(projectRoot, "build", "koin-icon.png") }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(`${APP_ORIGIN}/`);
}

app.whenReady().then(async () => {
  await registerKoinProtocol();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
