<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "#app";
import { useAuth } from "~/shared/composables/auth.js";
import { useDivesStore } from "~/shared/composables/use-dives-store.js";
import { useAppShell } from "~/shared/composables/use-app-shell.js";
import { useAppNavigation } from "~/shared/composables/use-app-navigation.js";
import { detachSystemThemeListener, initializePreferences } from "~/shared/composables/app-preferences.js";
import { NAV_ITEMS } from "~/config/navigation.js";
import { filledIconStyle } from "~/shared/utils/core.js";
import LoginView from "~/features/auth/Login.vue";
import AppLoadingSkeleton from "~/components/AppLoadingSkeleton.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const divesStore = useDivesStore();
const shell = useAppShell();
const { openManualDiveCreator } = useAppNavigation();

const authLoaded = computed(() => auth.isLoaded?.value ?? true);
const isAuthenticated = computed(() => Boolean(auth.isSignedIn?.value));
const lastSessionId = ref(null);

const desktopNavItems = computed(() => NAV_ITEMS.filter((item) => item.id !== "map"));
const mobileNavItems = computed(() => NAV_ITEMS);

const activeNavId = computed(() => {
  const path = route.path;
  if (path.startsWith("/logs") || path.startsWith("/imports")) return "logs";
  if (path.startsWith("/map")) return "map";
  if (path.startsWith("/equipment")) return "equipment";
  if (path.startsWith("/settings")) return "settings";
  return "dashboard";
});

const activeMenuTitle = computed(() => {
  const path = route.path;
  if (path.startsWith("/logs") || path.startsWith("/imports")) return "Dive Logs";
  if (path.startsWith("/map")) return "Dive Map";
  if (path.startsWith("/equipment")) return "Equipment";
  if (path.startsWith("/settings")) return "Settings";
  return "Dashboard";
});

const loadingViewKey = computed(() => {
  const path = route.path;
  if (path.startsWith("/logs/create")) return "create";
  if (path.endsWith("/edit")) return "edit";
  if (path.startsWith("/imports")) return "imports";
  if (path.startsWith("/map")) return "map";
  if (path.startsWith("/equipment")) return "equipment";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/logs/") && route.params.diveId) return "detail";
  if (path.startsWith("/logs")) return "logs";
  return "dashboard";
});

const isMapRoute = computed(() => route.path.startsWith("/map"));

async function handleNavItemClick(itemId) {
  shell.closeAccountMenus();
  if (itemId === "dashboard") await router.push("/");
  else if (itemId === "logs") await router.push("/logs");
  else if (itemId === "map") await router.push("/map");
  else if (itemId === "equipment") await router.push("/equipment");
  else if (itemId === "settings") await router.push("/settings");
}

function handleLogNewDive() {
  shell.closeAccountMenus();
  openManualDiveCreator();
}

watch(
  [authLoaded, isAuthenticated, () => auth.sessionId?.value],
  async ([loaded, signedIn, sessionId]) => {
    if (!loaded || !signedIn || !sessionId) {
      shell.resetAuthenticatedState();
      return;
    }
    if (lastSessionId.value === sessionId) return;
    lastSessionId.value = sessionId;
    await shell.bootstrapAppData();
  },
  { immediate: true }
);

onMounted(async () => {
  await initializePreferences(shell.preferences.state);
});

onBeforeUnmount(() => {
  detachSystemThemeListener(shell.preferences.state);
});
</script>

<template>
  <div v-if="!authLoaded" class="flex min-h-screen items-center justify-center bg-background px-6 text-on-background">
    <section class="bg-surface-container-low p-10 shadow-panel">
      <p class="font-headline text-2xl font-bold">Loading secure access...</p>
    </section>
  </div>
  <LoginView
    v-else-if="!isAuthenticated"
    :current-locale="shell.preferences.currentLocale.value"
    :set-locale="shell.preferences.setLocale"
  />
  <div v-else class="app-stage relative min-h-screen overflow-hidden bg-background text-on-background">
    <div class="app-stage-wave auth-stage-wave auth-stage-wave-back"></div>
    <div class="app-stage-wave auth-stage-wave auth-stage-wave-front"></div>
    <div class="app-stage-caustics auth-stage-caustics"></div>

    <aside class="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-background shadow-[40px_0_40px_-20px_rgba(0,15,29,0.4)] md:flex">
      <div class="flex justify-center px-4 pb-2 pt-5">
        <div class="flex h-32 w-full items-center justify-center rounded-3xl shadow-panel">
          <img src="/logo-headline.png" alt="DiveVault" class="max-h-full w-full object-contain p-2" />
        </div>
      </div>
      <nav class="mt-6 flex-1 space-y-2">
        <div v-for="item in desktopNavItems" :key="item.id" class="space-y-2">
          <button
            type="button"
            @click="handleNavItemClick(item.id)"
            :disabled="item.disabled"
            class="group flex w-full items-center gap-4 p-4 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-100"
            :class="
              item.disabled
                ? 'border-l-4 border-tertiary bg-tertiary/12 text-tertiary'
                : activeNavId === item.id
                  ? 'border-r-4 border-primary bg-surface-container-high/70 text-primary'
                  : 'text-secondary opacity-70 hover:bg-surface-container-high hover:text-primary hover:opacity-100'
            "
          >
            <span
              class="material-symbols-outlined transition-transform group-active:scale-90"
              :style="activeNavId === item.id && !item.disabled ? filledIconStyle : ''"
            >
              {{ item.icon }}
            </span>
            <span class="hidden items-center gap-2 font-label text-[11px] font-bold md:flex">
              <span>{{ item.label }}</span>
              <span v-if="item.badge" class="rounded bg-tertiary px-2 py-0.5 text-[9px] font-black tracking-[0.18em] text-background">
                {{ item.badge }}
              </span>
            </span>
          </button>
        </div>
      </nav>
      <div class="mt-auto p-6">
        <button
          type="button"
          @click="handleLogNewDive"
          class="hidden w-full items-center justify-center gap-2 bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary transition-all hover:brightness-110 md:flex"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          Log New Dive
        </button>
      </div>
    </aside>

    <header
      class="fixed left-0 right-0 top-0 z-30 h-16 border-b border-primary/10 bg-surface-container-high/95 backdrop-blur-xl md:left-64 md:bg-background/80"
    >
      <div class="relative flex h-full items-center justify-between px-6 md:hidden">
        <div class="flex items-center gap-3">
          <div class="flex h-14 w-14 items-center justify-center rounded-2xl shadow-panel">
            <img src="/logo.png" alt="DiveVault" class="max-h-full max-w-full object-contain p-1" />
          </div>
          <h2 class="font-headline text-lg font-bold uppercase tracking-[0.14em] text-primary">{{ activeMenuTitle }}</h2>
        </div>
        <div class="relative">
          <UButton
            @click="shell.toggleMobileAccountMenu"
            class="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-surface-container-high text-[11px] font-bold uppercase tracking-[0.12em] text-primary"
          >
            {{ shell.currentUserInitials.value }}
          </UButton>
          <div
            v-if="shell.mobileAccountMenuOpen.value"
            class="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-56 rounded-2xl border border-primary/10 bg-surface-container-low p-3 shadow-panel"
          >
            <div class="border-b border-primary/10 pb-3">
              <p class="truncate text-sm font-semibold text-on-surface">{{ shell.currentUserName.value }}</p>
              <p class="mt-1 truncate text-xs text-secondary">{{ shell.currentUserEmail.value }}</p>
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <UButton
                @click="shell.openMobileSettings"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Open Settings
              </UButton>
              <UButton
                @click="shell.openPasswordDialog"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Change Password
              </UButton>
              <UButton
                @click="shell.signOutUser"
                class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
              >
                Sign Out
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <div class="hidden h-full items-center justify-between px-8 md:flex">
        <h2 class="font-headline text-2xl font-bold tracking-[0.08em] text-primary">{{ activeMenuTitle }}</h2>
        <div class="relative flex items-center gap-4 border-l border-primary/10 pl-5 text-on-surface">
          <div class="min-w-0 text-right">
            <p class="font-label text-[9px] font-bold uppercase tracking-[0.18em] text-secondary/70">Diver</p>
            <p class="max-w-[11rem] truncate text-sm font-semibold leading-5 text-on-surface">{{ shell.currentUserName.value }}</p>
          </div>
          <UButton
            @click="shell.toggleDesktopAccountMenu"
            type="button"
            aria-label="Account menu"
            :aria-expanded="shell.desktopAccountMenuOpen.value ? 'true' : 'false'"
            class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-background/50 text-[11px] font-bold uppercase tracking-[0.12em] text-primary shadow-[inset_0_1px_0_rgba(205,229,255,0.08)] transition-colors hover:border-primary/35 hover:bg-primary/12"
          >
            {{ shell.currentUserInitials.value }}
            <span
              class="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-surface-container-high text-secondary"
            >
              <span
                class="material-symbols-outlined text-[14px] transition-transform"
                :class="shell.desktopAccountMenuOpen.value ? 'rotate-180 text-primary' : ''"
              >
                expand_more
              </span>
            </span>
          </UButton>
          <div
            v-if="shell.desktopAccountMenuOpen.value"
            class="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-56 rounded-2xl border border-primary/10 bg-surface-container-low p-3 shadow-panel"
          >
            <div class="border-b border-primary/10 pb-3">
              <p class="truncate text-sm font-semibold text-on-surface">{{ shell.currentUserName.value }}</p>
              <p class="mt-1 truncate text-xs text-secondary">{{ shell.currentUserEmail.value }}</p>
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <UButton
                @click="shell.openPasswordDialog"
                class="inline-flex items-center justify-center rounded-xl bg-surface-container-high px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-highest"
              >
                Change Password
              </UButton>
              <UButton
                @click="shell.signOutUser"
                class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-3 py-2 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
              >
                Sign Out
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section role="main" class="relative z-10 md:ml-64" :class="isMapRoute ? 'px-0 pb-0 pt-16' : 'pb-24 pt-20'">
      <div
        class="mx-auto"
        :class="isMapRoute ? 'w-full max-w-none px-0 md:max-w-[96rem] md:px-8' : 'max-w-md px-4 md:max-w-[96rem] md:px-8'"
      >
        <AppLoadingSkeleton v-if="divesStore.isLoading" :view-key="loadingViewKey" />
        <section v-else-if="divesStore.error" class="bg-error-container/25 p-10 shadow-panel">
          <p class="font-headline text-2xl font-bold text-on-error-container">Frontend could not load dive data</p>
          <p class="mt-2 text-sm text-on-error-container">{{ divesStore.error }}</p>
          <UButton
            @click="shell.bootstrapAppData"
            class="mt-5 bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-primary"
          >
            Retry
          </UButton>
        </section>
        <slot v-else />
      </div>
    </section>

    <nav
      class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-primary/10 bg-surface-container-low/80 px-4 pb-6 pt-3 backdrop-blur-xl md:hidden"
    >
      <UButton
        v-for="item in mobileNavItems"
        :key="item.id"
        @click="handleNavItemClick(item.id)"
        :disabled="item.disabled"
        class="flex flex-col items-center justify-center rounded-lg px-3 py-1 transition-all disabled:cursor-not-allowed disabled:opacity-100"
        :class="
          item.disabled
            ? 'bg-tertiary/12 text-tertiary'
            : activeNavId === item.id
              ? 'bg-surface-container-high text-primary'
              : 'text-secondary/60'
        "
      >
        <span class="material-symbols-outlined mb-1" :style="!item.disabled && activeNavId === item.id ? filledIconStyle : ''">
          {{ item.mobileIcon || item.icon }}
        </span>
        <span class="font-label text-[10px] font-bold">{{ item.mobileLabel }}</span>
      </UButton>
    </nav>

    <div
      v-if="shell.passwordDialogOpen.value"
      @click.self="shell.closePasswordDialog"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-background/88 px-6 py-8 backdrop-blur-sm"
    >
      <div class="w-full max-w-md rounded-3xl border border-primary/10 bg-surface-container-low p-6 shadow-panel">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Account Security</p>
            <h3 class="mt-3 font-headline text-2xl font-bold tracking-tight text-on-surface">Change Password</h3>
            <p class="mt-3 text-sm leading-6 text-secondary">Update the password for your current DiveVault account.</p>
          </div>
          <UButton
            @click="shell.closePasswordDialog"
            :disabled="shell.passwordSubmitting.value"
            class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/10 text-secondary transition-colors hover:bg-surface-container-high"
          >
            <span class="material-symbols-outlined text-lg">close</span>
          </UButton>
        </div>

        <p v-if="shell.passwordStatus.value" class="mt-5 text-sm text-primary">{{ shell.passwordStatus.value }}</p>
        <p v-if="shell.passwordError.value" class="mt-5 text-sm text-error">{{ shell.passwordError.value }}</p>

        <div class="mt-5 space-y-4">
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Current Password</span>
            <UInput
              v-model="shell.passwordForm.currentPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">New Password</span>
            <UInput
              v-model="shell.passwordForm.newPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Confirm New Password</span>
            <UInput
              v-model="shell.passwordForm.confirmPassword"
              type="password"
              class="w-full rounded-2xl border border-primary/15 bg-background/20 px-4 py-3 text-sm text-on-surface outline-none transition-colors focus:border-primary/40"
            />
          </label>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <UButton
            @click="shell.submitPasswordChange"
            :disabled="shell.passwordSubmitting.value"
            class="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-on-primary transition-all hover:brightness-110"
          >
            {{ shell.passwordSubmitting.value ? "Updating Password" : "Update Password" }}
          </UButton>
          <UButton
            @click="shell.closePasswordDialog"
            :disabled="shell.passwordSubmitting.value"
            class="inline-flex items-center justify-center rounded-xl border border-primary/15 px-4 py-3 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-primary transition-colors hover:bg-surface-container-high"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
