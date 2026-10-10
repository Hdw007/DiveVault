<script setup>
import { computed } from "vue";

const props = defineProps({
  viewKey: {
    type: String,
    default: "dashboard"
  }
});

const loadingTitle = computed(() => {
  switch (props.viewKey) {
    case "dashboard":
      return "Loading Dashboard";
    case "map":
      return "Loading Dive Map";
    case "logs":
      return "Loading Dive Log";
    case "detail":
      return "Loading Dive Detail";
    case "imports":
      return "Loading Imports";
    case "edit":
      return "Loading Dive Editor";
    case "create":
      return "Loading Manual Entry";
    case "equipment":
      return "Loading Equipment";
    default:
      return "Loading Settings";
  }
});
</script>

<template>
  <section class="space-y-6">
    <div class="border border-primary/10 bg-surface-container-low p-6 shadow-panel animate-pulse">
      <p class="font-label text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
        {{ loadingTitle }}
      </p>
      <div class="mt-4 h-9 w-56 bg-surface-container-high"></div>
      <div class="mt-3 h-4 w-72 max-w-full bg-surface-container-high/80"></div>
    </div>

    <div v-if="viewKey === 'dashboard'" class="space-y-6 animate-pulse">
      <div class="dashboard-command-center space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="index in 4" :key="'dashboard-stat-' + index" class="h-36 rounded-2xl bg-surface-container-low shadow-panel"></div>
        </div>
        <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="space-y-6">
            <div class="h-[28rem] rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
            <div class="grid gap-4 md:grid-cols-3">
              <div
                v-for="index in 3"
                :key="'dashboard-recent-' + index"
                class="h-28 rounded-2xl bg-surface-container-low shadow-panel"
              ></div>
            </div>
          </div>
          <div class="space-y-4">
            <div class="h-44 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
            <div class="h-44 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="viewKey === 'map'" class="dashboard-command-center dashboard-map-only animate-pulse">
      <section class="dashboard-section dashboard-map-section relative min-h-[calc(100vh-10rem)]">
        <div
          class="dashboard-glass-card dashboard-map-panel relative h-full min-h-[calc(100vh-10rem)] overflow-hidden rounded-[1.5rem] bg-surface-container-low shadow-panel"
        >
          <div class="absolute left-6 top-6 z-10 space-y-3">
            <div class="h-4 w-40 rounded bg-surface-container-high"></div>
            <div class="h-9 w-72 rounded bg-surface-container-high"></div>
            <div class="h-4 w-96 max-w-full rounded bg-surface-container-high"></div>
          </div>
          <div class="absolute inset-0 bg-surface-container-high/60"></div>
          <div class="absolute inset-0 technical-grid opacity-[0.12]"></div>
          <div class="absolute bottom-8 left-8 flex gap-3">
            <div v-for="index in 4" :key="'map-site-chip-' + index" class="h-14 w-44 rounded-xl bg-surface-container-low"></div>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="viewKey === 'equipment'" class="dashboard-command-center animate-pulse">
      <div class="flex justify-end">
        <div class="h-12 w-[24rem] rounded-xl bg-surface-container-low shadow-panel"></div>
      </div>
      <div class="settings-stat-strip">
        <div v-for="index in 2" :key="'equipment-stat-' + index" class="h-20 rounded-2xl bg-surface-container-low shadow-panel"></div>
      </div>
      <div class="equipment-page-layout">
        <aside class="settings-panel settings-card equipment-service-sidebar h-[34rem] bg-surface-container-low shadow-panel"></aside>
        <section class="min-w-0">
          <div class="equipment-items-grid">
            <div v-for="index in 6" :key="'equipment-card-' + index" class="h-64 rounded-2xl bg-surface-container-low shadow-panel"></div>
          </div>
        </section>
      </div>
    </div>

    <div v-else-if="viewKey === 'logs'" class="space-y-6 animate-pulse">
      <div class="dashboard-command-center space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="index in 4" :key="'logs-stat-' + index" class="h-32 rounded-2xl bg-surface-container-low shadow-panel"></div>
        </div>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div class="h-24 rounded-2xl bg-surface-container-low shadow-panel"></div>
          <div class="h-24 rounded-2xl bg-surface-container-low shadow-panel"></div>
        </div>
        <div class="space-y-4">
          <div v-for="index in 5" :key="'logs-card-' + index" class="h-36 rounded-2xl bg-surface-container-low shadow-panel"></div>
        </div>
      </div>
    </div>

    <div v-else-if="viewKey === 'detail'" class="space-y-6 animate-pulse">
      <div class="relative h-[19rem] overflow-hidden rounded-[2rem] bg-surface-container-low shadow-panel">
        <div class="absolute left-8 top-8 h-11 w-36 rounded-xl bg-surface-container-high"></div>
        <div class="absolute bottom-8 left-8 right-8 space-y-5">
          <div class="h-5 w-80 rounded bg-surface-container-high"></div>
          <div class="h-14 max-w-3xl rounded bg-surface-container-high"></div>
          <div class="flex flex-wrap gap-10">
            <div v-for="index in 4" :key="'detail-hero-metric-' + index" class="space-y-2">
              <div class="h-3 w-24 rounded bg-surface-container-high"></div>
              <div class="h-8 w-20 rounded bg-surface-container-high"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-12 gap-6">
        <div class="col-span-12 space-y-6 xl:col-span-8">
          <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
            <div class="mb-6 flex items-center justify-between">
              <div class="h-6 w-52 rounded bg-surface-container-high"></div>
              <div class="h-7 w-24 rounded-full bg-surface-container-high"></div>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div v-for="index in 6" :key="'detail-logbook-' + index" class="h-24 rounded-xl bg-surface-container-high"></div>
            </div>
          </div>
          <div class="h-[20rem] rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
        </div>
        <div class="col-span-12 xl:col-span-4">
          <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
            <div class="mb-5 h-5 w-56 rounded bg-surface-container-high"></div>
            <div class="divide-y divide-primary/10">
              <div v-for="index in 4" :key="'detail-telemetry-' + index" class="space-y-3 py-5 first:pt-0 last:pb-0">
                <div class="h-5 w-5 rounded bg-surface-container-high"></div>
                <div class="h-3 w-32 rounded bg-surface-container-high"></div>
                <div class="h-7 w-28 rounded bg-surface-container-high"></div>
                <div class="h-3 w-40 rounded bg-surface-container-high"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-span-12 pt-8">
          <div class="mb-5 h-6 w-44 rounded bg-surface-container-high"></div>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
            <div v-for="index in 5" :key="'detail-equipment-' + index" class="h-20 rounded-xl bg-surface-container-low shadow-panel"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="viewKey === 'imports'" class="space-y-6 animate-pulse">
      <div class="h-36 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.82fr)]">
        <div class="space-y-4">
          <div v-for="index in 5" :key="'imports-row-' + index" class="h-28 rounded-2xl bg-surface-container-low shadow-panel"></div>
        </div>
        <div class="space-y-4">
          <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
          <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
        </div>
      </div>
    </div>

    <div v-else-if="viewKey === 'edit'" class="space-y-6 animate-pulse">
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_22rem]">
        <div class="space-y-6">
          <div class="h-48 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
          <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
            <div class="grid gap-4 md:grid-cols-2">
              <div v-for="index in 10" :key="'edit-field-' + index" class="h-16 rounded-xl bg-surface-container-high"></div>
            </div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="h-64 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
          <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
        </div>
      </div>
    </div>

    <div v-else-if="viewKey === 'create'" class="space-y-6 animate-pulse">
      <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_22rem]">
        <div class="rounded-[1.5rem] bg-surface-container-low p-6 shadow-panel">
          <div class="grid gap-4 md:grid-cols-2">
            <div v-for="index in 12" :key="'create-field-' + index" class="h-16 rounded-xl bg-surface-container-high"></div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
          <div class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
        </div>
      </div>
    </div>

    <div v-else class="settings-layout animate-pulse">
      <aside class="settings-section-nav h-[42rem] bg-surface-container-low shadow-panel">
        <div class="space-y-3 p-4">
          <div v-for="index in 8" :key="'settings-nav-' + index" class="h-14 rounded-xl bg-surface-container-high"></div>
        </div>
      </aside>
      <section class="min-w-0 space-y-6">
        <div class="h-40 rounded-[1.5rem] bg-surface-container-low shadow-panel"></div>
        <div class="grid gap-6 md:grid-cols-2">
          <div
            v-for="index in 4"
            :key="'settings-panel-' + index"
            class="h-56 rounded-[1.5rem] bg-surface-container-low shadow-panel"
          ></div>
        </div>
      </section>
    </div>
  </section>
</template>
