import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['bufferutil', 'utf-8-validate']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'xhs-automation': resolve('src/main/preload/xhs-automation.ts'),
          'xhs-product-sync': resolve('src/main/preload/xhs-product-sync.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true
    },
    plugins: [react()]
  }
})
