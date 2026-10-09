import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src-tauri/target/release/koin.exe", import.meta.url));
const release = fileURLToPath(new URL("../release/", import.meta.url));
const target = fileURLToPath(new URL("../release/Koin-Portable-0.4.4-x64.exe", import.meta.url));

await mkdir(release, { recursive: true });
await copyFile(source, target);
const { size } = await stat(target);
console.log(`${target} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
