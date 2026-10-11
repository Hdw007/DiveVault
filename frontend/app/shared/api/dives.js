import { API_ENDPOINTS, diveLogbookUrl, diveUrl } from "./endpoints.js";

export function createDive(api, payload) {
  return api.request(API_ENDPOINTS.dives, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function deleteDive(api, diveId) {
  return api.request(diveUrl(diveId), { method: "DELETE" });
}

export function fetchDive(api, diveId, query = "include_samples=1") {
  const queryString = query ? `?${query}` : "";
  return api.request(`${diveUrl(diveId)}${queryString}`);
}

export function fetchDives(api, query = "limit=250&include_samples=0") {
  return api.request(`${API_ENDPOINTS.dives}?${query}`);
}

export function updateDiveLogbook(api, diveId, payload) {
  return api.request(diveLogbookUrl(diveId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function fetchDeviceState(api, vendor, product) {
  const url = `${API_ENDPOINTS.deviceState}?vendor=${encodeURIComponent(vendor)}&product=${encodeURIComponent(product)}`;
  return api.request(url);
}

export function saveDeviceState(api, vendor, product, fingerprintHex) {
  return api.request(API_ENDPOINTS.deviceState, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendor,
      product,
      fingerprint_hex: fingerprintHex
    })
  });
}
