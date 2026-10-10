import { defineNuxtRouteMiddleware, navigateTo } from "#app";
import { legacyHashToPath } from "~/routing/routes.js";

export default defineNuxtRouteMiddleware((to) => {
  const hash = to.hash || (typeof window !== "undefined" ? window.location.hash : "");
  if (!hash) return;

  const targetPath = legacyHashToPath(hash);
  if (targetPath && targetPath !== to.path) {
    return navigateTo(targetPath, { replace: true });
  }
});
