import { API_ENDPOINTS, geocodeSearchUrl, licensePdfUrl } from "./endpoints.js";

export function fetchHealth(api) {
  return api.request(API_ENDPOINTS.health, {}, { requireAuth: false });
}

export function fetchProfile(api) {
  return api.request(API_ENDPOINTS.profile);
}

export function searchGeocode(api, query) {
  return api.request(geocodeSearchUrl(query));
}

export function updateLicensePdf(api, licenseId, payload) {
  const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
  return api.request(licensePdfUrl(licenseId), {
    method: "PUT",
    ...(isFormData
      ? { body: payload }
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
  });
}

export function updateProfile(api, payload) {
  return api.request(API_ENDPOINTS.profile, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
