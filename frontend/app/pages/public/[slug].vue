<script setup>
import { computed } from "vue";
import { useRoute } from "#app";
import PublicProfileView from "~/features/public-profile/PublicProfile.vue";
import { singleRouteParam } from "~/routing/routes.js";

definePageMeta({
  layout: false
});

const route = useRoute();
const slug = computed(() => singleRouteParam(route.params.slug) || "");
</script>

<template>
  <PublicProfileView :slug="slug" />
</template>
