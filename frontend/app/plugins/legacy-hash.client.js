import { defineNuxtPlugin, useRouter } from "#app";
import { legacyHashToPath } from "~/routing/routes.js";

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof window === "undefined") return;

  const router = useRouter();

  async function handleHash() {
    const hash = window.location.hash;
    if (!hash) return;
    const targetPath = legacyHashToPath(hash);
    if (targetPath && targetPath !== router.currentRoute.value.path) {
      await router.replace(targetPath);
    }
  }

  nuxtApp.hook("app:mounted", () => {
    handleHash();
  });

  window.addEventListener("hashchange", handleHash);
});
