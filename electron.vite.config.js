import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const root = process.cwd()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(root, 'out/main'),
      rollupOptions: {
        input: resolve(root, 'src/main/index.js')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(root, 'out/preload'),
      rollupOptions: {
        input: resolve(root, 'src/main/preload.js')
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    publicDir: resolve(root, 'assets'),
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: {
        input: resolve(root, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
