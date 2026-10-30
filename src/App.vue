<script setup lang="ts">
import { onMounted } from "vue";
import { useCatalog } from "./catalog/useCatalog";

const { games, sourceLabel, loading, error, refresh } = useCatalog();

onMounted(() => {
  void refresh();
});
</script>

<template>
  <main class="app">
    <header>
      <h1>Discord Quest Completer</h1>
      <p v-if="loading" class="status">Loading catalog…</p>
      <p v-else-if="error" class="status error">{{ error }}</p>
      <p v-else-if="sourceLabel" class="status">
        {{ sourceLabel }} · {{ games.length.toLocaleString() }} games
      </p>
    </header>
  </main>
</template>

<style scoped>
.app {
  padding: 2rem;
}
.status {
  color: #b5bac1;
  font-size: 0.9rem;
}
.status.error {
  color: #f23f43;
}
</style>
