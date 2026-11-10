import { defineConfig } from 'vitest/config'

// 纯 JS 核心逻辑测试，不加载 uni 插件（uni 插件在 VITEST 下会触发 vue 别名导致 plugin-vue 启动失败）
export default defineConfig({
  plugins: [],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
