<script>
import { createApiClient } from "~/shared/api/client.js";
import { useAuth, useUser } from "~/shared/composables/auth.js";
import { formatSettingsDateTime as formatDateTime } from "~/shared/utils/settings-profile.js";

export default {
  name: "UserManagementTab",
  setup() {
    const { user } = useUser();
    const { getToken } = useAuth();
    const apiClient = createApiClient({ getToken: () => getToken({ skipCache: true }) });
    const authenticatedFetch = (res, opts) => apiClient.request(res, opts);

    return {
      authUser: user,
      authenticatedFetch
    };
  },
  data() {
    return {
      authSettings: {
        public_registration_enabled: false
      },
      authUsers: [],
      inviteDraft: {
        email: "",
        first_name: "",
        last_name: "",
        role: "user",
        expires_in_days: 7
      },
      latestInviteUrl: "",
      manageUsersStatus: "",
      manageUsersError: "",
      manageUsersLoading: false,
      manageUsersSaving: false,
      inviteSubmitting: false
    };
  },
  computed: {
    canManageUsers() {
      return this.authUser?.role === "admin" || Boolean(this.authUser?.isOwner);
    },
    ownerUserId() {
      return this.authUser?.isOwner ? this.authUser.id : this.authUsers.find((u) => u.role === "admin")?.id || "";
    }
  },
  watch: {
    canManageUsers: {
      immediate: true,
      async handler(value) {
        if (value) {
          await this.fetchUserManagement();
        } else {
          this.authUsers = [];
          this.latestInviteUrl = "";
          this.manageUsersStatus = "";
          this.manageUsersError = "";
        }
      }
    }
  },
  methods: {
    formatDateTime,
    displayValue(value, fallback = "—") {
      return value ? String(value).trim() || fallback : fallback;
    },
    async readErrorResponse(response, fallbackMessage = "") {
      const payload = await response.json().catch(() => null);
      if (payload?.error) return payload.error;
      const bodyText = await response.text().catch(() => "");
      return bodyText || fallbackMessage || `API returned ${response.status}`;
    },
    async fetchUserManagement() {
      if (!this.canManageUsers) return;
      this.manageUsersLoading = true;
      this.manageUsersError = "";
      try {
        const [settingsResponse, usersResponse] = await Promise.all([
          this.authenticatedFetch("/api/auth/settings"),
          this.authenticatedFetch("/api/users")
        ]);
        if (!settingsResponse.ok) {
          throw new Error(await this.readErrorResponse(settingsResponse, "Could not load authentication settings."));
        }
        if (!usersResponse.ok) {
          throw new Error(await this.readErrorResponse(usersResponse, "Could not load the user list."));
        }
        const [settingsPayload, usersPayload] = await Promise.all([
          settingsResponse.json().catch(() => ({})),
          usersResponse.json().catch(() => ({}))
        ]);
        this.authSettings = {
          public_registration_enabled: Boolean(settingsPayload?.public_registration_enabled),
          owner_user_id: settingsPayload?.owner_user_id || "",
          user_count: Number(settingsPayload?.user_count || usersPayload?.users?.length || 0),
          initialized: Boolean(settingsPayload?.initialized)
        };
        this.authUsers = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
      } catch (error) {
        this.manageUsersError = error?.message || "Could not load user management.";
      } finally {
        this.manageUsersLoading = false;
      }
    },
    async savePublicRegistrationSetting() {
      this.manageUsersSaving = true;
      this.manageUsersError = "";
      this.manageUsersStatus = "";
      try {
        const response = await this.authenticatedFetch("/api/auth/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_registration_enabled: Boolean(this.authSettings.public_registration_enabled)
          })
        });
        if (!response.ok) {
          throw new Error(await this.readErrorResponse(response, "Could not update public registration."));
        }
        const payload = await response.json().catch(() => ({}));
        this.authSettings = {
          public_registration_enabled: Boolean(payload?.public_registration_enabled),
          owner_user_id: payload?.owner_user_id || "",
          user_count: Number(payload?.user_count || this.authUsers.length),
          initialized: Boolean(payload?.initialized)
        };
        this.manageUsersStatus = this.authSettings.public_registration_enabled
          ? "Public registration enabled."
          : "Public registration disabled.";
      } catch (error) {
        this.manageUsersError = error?.message || "Could not update public registration.";
      } finally {
        this.manageUsersSaving = false;
      }
    },
    async createUserInvite() {
      this.inviteSubmitting = true;
      this.manageUsersError = "";
      this.manageUsersStatus = "";
      try {
        const response = await this.authenticatedFetch("/api/auth/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.inviteDraft)
        });
        if (!response.ok) {
          throw new Error(await this.readErrorResponse(response, "Could not create the invitation."));
        }
        const payload = await response.json().catch(() => ({}));
        const invite = payload?.invitation || {};
        this.latestInviteUrl = invite.invite_url || "";
        this.manageUsersStatus = `Invitation created for ${invite.email || this.inviteDraft.email}.`;
        this.inviteDraft = {
          email: "",
          first_name: "",
          last_name: "",
          role: this.inviteDraft.role,
          expires_in_days: this.inviteDraft.expires_in_days
        };
        await this.fetchUserManagement();
      } catch (error) {
        this.manageUsersError = error?.message || "Could not create the invitation.";
      } finally {
        this.inviteSubmitting = false;
      }
    },
    async copyLatestInviteUrl() {
      if (!this.latestInviteUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
      await navigator.clipboard.writeText(this.latestInviteUrl);
      this.manageUsersStatus = "Invite link copied to clipboard.";
    },
    async toggleManagedUserActive(user) {
      this.manageUsersSaving = true;
      this.manageUsersError = "";
      this.manageUsersStatus = "";
      try {
        const response = await this.authenticatedFetch(`/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !user.is_active })
        });
        if (!response.ok) {
          throw new Error(await this.readErrorResponse(response, "Could not update the user status."));
        }
        const payload = await response.json().catch(() => ({}));
        const updatedUser = payload?.user || user;
        this.manageUsersStatus = updatedUser.is_active ? `Reactivated ${updatedUser.email}.` : `Deactivated ${updatedUser.email}.`;
        await this.fetchUserManagement();
      } catch (error) {
        this.manageUsersError = error?.message || "Could not update the user status.";
      } finally {
        this.manageUsersSaving = false;
      }
    },
    async toggleManagedUserRole(user) {
      const nextRole = user.role === "admin" ? "user" : "admin";
      this.manageUsersSaving = true;
      this.manageUsersError = "";
      this.manageUsersStatus = "";
      try {
        const response = await this.authenticatedFetch(`/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole })
        });
        if (!response.ok) {
          throw new Error(await this.readErrorResponse(response, "Could not update the user role."));
        }
        this.manageUsersStatus = `${user.email} is now ${nextRole}.`;
        await this.fetchUserManagement();
      } catch (error) {
        this.manageUsersError = error?.message || "Could not update the user role.";
      } finally {
        this.manageUsersSaving = false;
      }
    },
    async deleteManagedUser(user) {
      this.manageUsersSaving = true;
      this.manageUsersError = "";
      this.manageUsersStatus = "";
      try {
        const response = await this.authenticatedFetch(`/api/users/${user.id}`, {
          method: "DELETE"
        });
        if (!response.ok) {
          throw new Error(await this.readErrorResponse(response, "Could not delete the user."));
        }
        this.manageUsersStatus = `${user.email} was removed.`;
        await this.fetchUserManagement();
      } catch (error) {
        this.manageUsersError = error?.message || "Could not delete the user.";
      } finally {
        this.manageUsersSaving = false;
      }
    }
  }
};
</script>

<template>
  <div class="settings-panel settings-card">
    <div class="settings-card-header">
      <div>
        <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Manage Users</p>
        <h4 class="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Invites And Access Control</h4>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-secondary">
          Invite new divers, review who can sign in, and control whether self-registration is open on this instance.
        </p>
      </div>
    </div>

    <div v-if="manageUsersStatus" class="settings-feedback border-primary/20 bg-primary/10 text-primary">{{ manageUsersStatus }}</div>
    <div v-if="manageUsersError" class="settings-feedback border-error/20 bg-error-container/20 text-on-error-container">
      {{ manageUsersError }}
    </div>

    <div class="settings-action-grid">
      <div class="settings-action-card">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-primary">how_to_reg</span>
              <p class="font-headline text-xl font-bold text-on-surface">Public Registration</p>
            </div>
            <p class="mt-3 text-sm leading-6 text-secondary">
              Keep sign-up closed and use invitations only, or open self-registration for this DiveVault instance.
            </p>
          </div>
          <span class="settings-chip" :class="authSettings.public_registration_enabled ? 'is-accent' : ''">
            {{ authSettings.public_registration_enabled ? "Open" : "Invite only" }}
          </span>
        </div>
        <label class="mt-5 flex items-start gap-4 rounded-2xl border border-primary/10 bg-background/20 px-4 py-4">
          <UCheckbox
            v-model="authSettings.public_registration_enabled"
            class="mt-1"
            :ui="{ base: 'h-5 w-5 rounded border-primary/20 bg-surface-container-high text-primary focus:ring-primary/30' }"
          />
          <div>
            <p class="text-sm font-semibold text-on-surface">Allow direct account creation</p>
            <p class="mt-1 text-sm leading-6 text-secondary">
              When disabled, new users must come through an invite link from the instance owner.
            </p>
          </div>
        </label>
        <UButton
          @click="savePublicRegistrationSetting"
          :disabled="manageUsersSaving || manageUsersLoading"
          class="settings-button settings-button-primary mt-5"
        >
          {{ manageUsersSaving ? "Saving Access Policy" : "Save Access Policy" }}
        </UButton>
      </div>

      <div class="settings-action-card">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-primary">person_add</span>
              <p class="font-headline text-xl font-bold text-on-surface">Invite User</p>
            </div>
            <p class="mt-3 text-sm leading-6 text-secondary">
              Create a one-time sign-up link for a second diver or admin on this instance.
            </p>
          </div>
          <span class="settings-chip">{{ authUsers.length }} users</span>
        </div>
        <div class="mt-5 grid gap-4 md:grid-cols-2">
          <label class="space-y-2 md:col-span-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Email</span>
            <UInput v-model.trim="inviteDraft.email" type="email" class="settings-input" placeholder="second-user@example.com" />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">First Name</span>
            <UInput v-model.trim="inviteDraft.first_name" type="text" class="settings-input" placeholder="First name" />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Last Name</span>
            <UInput v-model.trim="inviteDraft.last_name" type="text" class="settings-input" placeholder="Last name" />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Role</span>
            <USelect
              v-model="inviteDraft.role"
              :items="[
                { label: 'User', value: 'user' },
                { label: 'Admin', value: 'admin' }
              ]"
              class="settings-input"
            />
          </label>
          <label class="space-y-2">
            <span class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Expires In Days</span>
            <UInput v-model.number="inviteDraft.expires_in_days" type="number" min="1" max="30" class="settings-input" />
          </label>
        </div>
        <div class="mt-5 flex flex-wrap gap-3">
          <UButton
            @click="createUserInvite"
            :disabled="inviteSubmitting || manageUsersLoading"
            class="settings-button settings-button-primary"
          >
            {{ inviteSubmitting ? "Creating Invite" : "Create Invite" }}
          </UButton>
          <UButton v-if="latestInviteUrl" @click="copyLatestInviteUrl" class="settings-button settings-button-secondary"
            >Copy Invite Link</UButton
          >
        </div>
        <div v-if="latestInviteUrl" class="mt-5 rounded-2xl border border-primary/10 bg-background/20 px-4 py-4">
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Latest Invite Link</p>
          <p class="mt-2 break-all text-sm font-semibold text-primary">{{ latestInviteUrl }}</p>
        </div>
      </div>
    </div>

    <div class="mt-6 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Current Users</p>
          <p class="mt-2 text-sm text-secondary">
            The owner account stays protected. Other users can be promoted, disabled, or removed here.
          </p>
        </div>
        <UButton
          @click="fetchUserManagement"
          :disabled="manageUsersLoading || manageUsersSaving"
          class="settings-button settings-button-secondary"
        >
          {{ manageUsersLoading ? "Refreshing" : "Refresh" }}
        </UButton>
      </div>

      <div v-if="manageUsersLoading && authUsers.length === 0" class="settings-empty-state">
        <p class="font-headline text-lg font-bold">Loading users</p>
        <p class="mt-2 text-sm text-secondary">Reading the current instance access list.</p>
      </div>

      <div v-else-if="authUsers.length === 0" class="settings-empty-state">
        <p class="font-headline text-lg font-bold">No users found</p>
        <p class="mt-2 text-sm text-secondary">Create an invitation above to add another diver.</p>
      </div>

      <div v-else class="space-y-4">
        <article v-for="user in authUsers" :key="user.id" class="settings-item-card">
          <div class="settings-item-header">
            <div class="min-w-0">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
                {{ user.id === ownerUserId ? "Owner" : "User" }}
              </p>
              <h5 class="mt-2 font-headline text-2xl font-bold tracking-tight text-on-surface">{{ user.email }}</h5>
              <div class="settings-chip-row mt-3">
                <span class="settings-chip" :class="user.role === 'admin' ? 'is-accent' : ''">{{ user.role }}</span>
                <span class="settings-chip" :class="user.is_active ? 'is-accent' : ''">{{ user.is_active ? "Active" : "Inactive" }}</span>
                <span v-if="user.id === ownerUserId" class="settings-chip">Protected</span>
              </div>
            </div>

            <div v-if="user.id !== ownerUserId" class="settings-toolbar">
              <UButton @click="toggleManagedUserRole(user)" :disabled="manageUsersSaving" class="settings-button settings-button-secondary">
                {{ user.role === "admin" ? "Make User" : "Make Admin" }}
              </UButton>
              <UButton
                @click="toggleManagedUserActive(user)"
                :disabled="manageUsersSaving"
                class="settings-button settings-button-secondary"
              >
                {{ user.is_active ? "Deactivate" : "Activate" }}
              </UButton>
              <UButton @click="deleteManagedUser(user)" :disabled="manageUsersSaving" class="settings-button settings-button-danger"
                >Delete</UButton
              >
            </div>
          </div>

          <div class="settings-detail-grid">
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Name</p>
              <p class="mt-2 text-base font-semibold text-on-surface">
                {{ displayValue([user.first_name, user.last_name].filter(Boolean).join(" ")) }}
              </p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Last Login</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ formatDateTime(user.last_login_at) }}</p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Created</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ formatDateTime(user.created_at) }}</p>
            </div>
            <div class="settings-info-card">
              <p class="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Updated</p>
              <p class="mt-2 text-base font-semibold text-on-surface">{{ formatDateTime(user.updated_at) }}</p>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
