import { defineConfig } from 'vite'

export default defineConfig({
    // Vite config options
    root: 'src',
    server: {
        port: 5173,
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
})
