import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  // O ffmpeg.wasm cria um Web Worker relativo ao próprio pacote; o pré-bundle
  // do Vite quebra esse caminho (worker.js 404) e a conversão nunca termina.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    sourcemap: false,
    // O CRM é grande por natureza; o aviso padrão de 500kB só gera ruído.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        /**
         * Separa apenas dependências que NÃO dependem do runtime do React.
         *
         * Qualquer biblioteca que importe React (router, radix, recharts,
         * lucide) precisa ficar no mesmo grafo do React; separá-las criava
         * ordem de carregamento errada e o erro
         * "Cannot read properties of undefined (reading 'createContext')".
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("date-fns")) return "vendor-date";
          return undefined;
        },
      },
    },

  },
}));