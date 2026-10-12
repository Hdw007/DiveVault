import { API_ENDPOINTS, authStatusUrl } from "./endpoints.js";

export function fetchAuthSettings(api) {
  return api.request(API_ENDPOINTS.authSettings);
}

export function fetchAuthStatus(api, query = "") {
  return api.request(authStatusUrl(query), {}, { requireAuth: false });
}

export function fetchUsers(api) {
  return api.request(API_ENDPOINTS.users);
}

export function inviteUser(api, payload) {
  return api.request(API_ENDPOINTS.authInvitations, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateAuthSettings(api, payload) {
  return api.request(API_ENDPOINTS.authSettings, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updatePassword(api, payload) {
  return api.request(API_ENDPOINTS.authPassword, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
