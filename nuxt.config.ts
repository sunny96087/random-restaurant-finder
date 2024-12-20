// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
   // 配置 Vue 編譯器選項
   vue: {
    compilerOptions: {
      isCustomElement: (tag) => tag.includes('google-map')
    }
  },

  // 環境變量配置
  runtimeConfig: {
    public: {
      googleMapsApiKey: process.env.VITE_GOOGLE_MAPS_API_KEY
    }
  }
})
