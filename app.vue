<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>

<script setup>
// 設置頁面標題和其他 meta 信息
useHead({
  title: '欸要吃什麼 - 隨機抽抽',
  meta: [
    { charset: 'UTF-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }
  ],
  link: [
    { rel: 'icon', href: '/food.png' },
    { 
      rel: 'stylesheet', 
      href: 'https://fonts.googleapis.com/icon?family=Material+Icons'
    }
  ]
})
</script>

<style scoped>
#app {
  min-height: 100vh;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
}
</style>
