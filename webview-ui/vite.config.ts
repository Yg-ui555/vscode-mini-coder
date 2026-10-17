import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：构建输出到 ../dist-webview
// VS Code Webview 通过 file:// 协议加载
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist-webview',
    emptyOutDir: true,
    // 单文件输出（Webview 资源简单）
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  // Webview 用 file:// 协议，base 设为 './'
  base: './',
});