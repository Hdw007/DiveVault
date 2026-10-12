import { SETTINGS_SECTIONS } from "../config/settings-sections.js";

export const DEFAULT_SETTINGS_SECTION = SETTINGS_SECTIONS[0]?.id || "diver-details";
export const SETTINGS_SECTION_IDS = new Set(SETTINGS_SECTIONS.map((section) => section.id));

export const MAIN_ROUTE_BY_VIEW = {
  dashboard: "/",
  logs: "/logs",
  map: "/map",
  equipment: "/equipment",
  settings: "/settings"
};

export const PRERENDER_ROUTES = ["/", "/logs", "/logs/create", "/imports", "/map", "/equipment", "/settings"];

export function singleRouteParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function legacyHashToPath(hash) {
  const normalizedHash = String(hash || "").replace(/^#/, "");
  const [view, segment] = normalizedHash.split("/");
  if (view === "imports") return segment ? `/imports/${encodePathSegment(segment)}` : "/imports";
  if (view === "edit") return segment ? `/logs/${encodePathSegment(segment)}/edit` : "/logs";
  if (view === "create") return "/logs/create";
  if (view === "settings") {
    return segment ? `/settings/${encodePathSegment(segment)}` : "/settings";
  }
  if (view === "logs") return segment ? `/logs/${encodePathSegment(segment)}` : "/logs";
  if (MAIN_ROUTE_BY_VIEW[view]) return MAIN_ROUTE_BY_VIEW[view];
  return null;
}
