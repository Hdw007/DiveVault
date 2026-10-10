import { equipmentTitle, serviceStatusForDive } from "~/shared/utils/equipment-dive.js";

export const TANK_VOLUME_OPTIONS = [
  { label: "9L", value: "9" },
  { label: "12L", value: "12" },
  { label: "15L", value: "15" }
];

export function normalizeFormDraft(draft = {}) {
  return {
    site: draft.site ?? "",
    buddy: draft.buddy ?? "",
    guide: draft.guide ?? "",
    tank_volume_l: String(draft.tank_volume_l ?? draft.tankVolumeL ?? ""),
    begin_pressure_bar: String(draft.begin_pressure_bar ?? draft.beginPressureBar ?? ""),
    end_pressure_bar: String(draft.end_pressure_bar ?? draft.endPressureBar ?? ""),
    weather_description: draft.weather_description ?? draft.weatherDescription ?? "",
    visibility: draft.visibility ?? "",
    wetsuit_description: draft.wetsuit_description ?? draft.wetsuitDescription ?? "",
    weight_description: draft.weight_description ?? draft.weightDescription ?? "",
    notes: draft.notes ?? "",
    equipment_ids: Array.isArray(draft.equipment_ids) ? draft.equipment_ids.map(String) : []
  };
}

export function validateDivePressures(beginInput, endInput) {
  const issues = [];
  const beginStr = typeof beginInput === "string" ? beginInput.trim() : beginInput ? String(beginInput).trim() : "";
  const endStr = typeof endInput === "string" ? endInput.trim() : endInput ? String(endInput).trim() : "";
  const begin = beginStr ? Number.parseFloat(beginStr) : null;
  const end = endStr ? Number.parseFloat(endStr) : null;

  if (beginStr && (!Number.isFinite(begin) || begin < 0 || begin > 400)) {
    issues.push("Entry tank pressure must be between 0 and 400 bar.");
  }
  if (endStr && (!Number.isFinite(end) || end < 0 || end > 400)) {
    issues.push("Exit tank pressure must be between 0 and 400 bar.");
  }
  if (begin !== null && end !== null && end > begin) {
    issues.push("Exit tank pressure cannot be higher than entry tank pressure.");
  }
  return issues;
}

export function groupEquipmentByCategory(equipment) {
  const groups = new Map();
  for (const item of Array.isArray(equipment) ? equipment : []) {
    const category = item?.category || item?.type || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return [...groups.entries()].map(([category, items]) => ({
    category,
    items: items.sort((left, right) => equipmentTitle(left).localeCompare(equipmentTitle(right), undefined, { sensitivity: "base" }))
  }));
}

export function resolveEquipmentStatus(equipmentIds, equipment, startedAt) {
  const selectedIds = Array.isArray(equipmentIds) ? equipmentIds.map(String) : [];
  const lookup = new Map((Array.isArray(equipment) ? equipment : []).map((item) => [String(item.id), item]));
  return selectedIds.map((id) => {
    const item = lookup.get(id);
    const service = serviceStatusForDive(item, startedAt);
    return { id, item, name: equipmentTitle(item || { name: id }), ...service };
  });
}

export function siteCoordinateLabel(site) {
  if (!site) return "GPS coordinates unavailable";
  const latitude = site.latitude ?? site.lat;
  const longitude = site.longitude ?? site.lon;
  if (latitude === null || latitude === undefined || latitude === "" || longitude === null || longitude === undefined || longitude === "") {
    return "GPS coordinates unavailable";
  }
  return `Lat ${latitude}, Lon ${longitude}`;
}

export function formatDiveSiteSuggestionDetail(site) {
  if (!site) return "";
  const parts = [];
  if (typeof site.location === "string" && site.location.trim()) {
    parts.push(site.location.trim());
  }
  if (typeof site.country === "string" && site.country.trim()) {
    parts.push(site.country.trim());
  }
  const latitude = site.latitude ?? site.lat;
  const longitude = site.longitude ?? site.lon;
  if (latitude !== null && latitude !== undefined && latitude !== "" && longitude !== null && longitude !== undefined && longitude !== "") {
    parts.push("GPS ready");
  }
  return parts.join(" / ");
}
