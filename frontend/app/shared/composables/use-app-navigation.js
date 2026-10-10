import { useRouter } from "#app";
import { MAIN_ROUTE_BY_VIEW, encodePathSegment } from "~/routing/routes.js";

export function useAppNavigation() {
  const router = useRouter();

  async function openDive(diveId) {
    if (!diveId) return;
    await router.push(`/logs/${encodePathSegment(diveId)}`);
  }

  async function closeDiveDetail() {
    await router.push("/logs");
  }

  async function openDiveEditor(diveId) {
    if (!diveId) return;
    await router.push(`/logs/${encodePathSegment(diveId)}/edit`);
  }

  async function closeDiveEditor(diveId) {
    if (diveId) {
      await router.push(`/logs/${encodePathSegment(diveId)}`);
    } else {
      await router.push("/logs");
    }
  }

  async function openManualDiveCreator() {
    await router.push("/logs/create");
  }

  async function closeManualDiveCreator() {
    await router.push("/logs");
  }

  async function openImportQueue(diveId = null) {
    await router.push(diveId ? `/imports/${encodePathSegment(diveId)}` : "/imports");
  }

  async function selectImportDive(diveId) {
    if (!diveId) return;
    await router.push(`/imports/${encodePathSegment(diveId)}`);
  }

  async function backToQueue() {
    await router.push("/imports");
  }

  async function setView(view) {
    await router.push(MAIN_ROUTE_BY_VIEW[view] || "/");
  }

  async function setSettingsSection(section) {
    await router.push(`/settings/${encodePathSegment(section)}`);
  }

  return {
    openDive,
    closeDiveDetail,
    openDiveEditor,
    closeDiveEditor,
    openManualDiveCreator,
    closeManualDiveCreator,
    openImportQueue,
    selectImportDive,
    backToQueue,
    setView,
    setSettingsSection
  };
}
