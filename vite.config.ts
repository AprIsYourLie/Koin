import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/release/**"] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
