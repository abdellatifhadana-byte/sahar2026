import { db } from './db.js';
import ZoneAccessManager from './zone-access.js';
import { normalizeRole } from './roles.js';

export const ZONE_ACCESS_RUNTIME_FIX_VERSION = 1;
const PATCH = Symbol.for('2m-tech.zone-access-runtime-fix.v1');

const safeUser = record => {
  if (!record || typeof record !== 'object') return null;
  const { password, passwordHash, passwordScheme, platformAdminResetVersion, platformAdminResetAt, ...safe } = record;
  return safe;
};

function mergeUsers(...groups) {
  const map = new Map();
  for (const group of groups) for (const record of group || []) {
    const user = safeUser(record);
    if (user?.id == null) continue;
    map.set(String(user.id), { ...(map.get(String(user.id)) || {}), ...user });
  }
  return [...map.values()];
}

async function usersFromCentralSnapshot() {
  try {
    const response = await fetch('/api/sync', { credentials:'include', cache:'no-store' });
    if (!response.ok) return [];
    const snapshot = await response.json();
    return (snapshot?.data?.users || []).map(safeUser).filter(Boolean);
  } catch { return []; }
}

async function recoverAdminUsers(apiUsers = []) {
  let localUsers = [];
  try { localUsers = await db.getAll('users'); } catch {}
  let users = mergeUsers(apiUsers, localUsers);
  const assignable = users.filter(user => normalizeRole(user.role) !== 'admin');
  if (assignable.length) return users;
  const remoteUsers = await usersFromCentralSnapshot();
  return mergeUsers(users, remoteUsers);
}

if (!ZoneAccessManager.prototype[PATCH]) {
  const originalLoad = ZoneAccessManager.prototype.load;
  const originalAfterRender = ZoneAccessManager.prototype.afterRender;

  ZoneAccessManager.prototype.load = async function loadZoneAccessWithCanonicalUsers() {
    const data = await originalLoad.call(this);
    if (normalizeRole(this.user?.role) === 'admin') {
      data.users = await recoverAdminUsers(data.users || []);
    }
    data.users = (data.users || []).filter(Boolean);
    data.zones = (data.zones || []).filter(Boolean);
    data.memberships = (data.memberships || []).filter(Boolean);
    data.grants = (data.grants || []).filter(Boolean);
    this.data = data;
    return data;
  };

  ZoneAccessManager.prototype.afterRender = async function afterRenderWithRuntimeState() {
    await originalAfterRender.call(this);
    const form = document.getElementById('zone-membership-form');
    if (!form) return;
    const userSelect = form.elements.userId;
    const zoneSelect = form.elements.zoneId;
    const assignableUsers = (this.data?.users || []).filter(user => normalizeRole(user.role) !== 'admin');

    document.getElementById('zone-access-runtime-state')?.remove();
    const state = document.createElement('div');
    state.id = 'zone-access-runtime-state';
    state.className = `zone-access-runtime-state ${assignableUsers.length && (this.data?.zones || []).length ? 'is-ready' : 'is-warning'}`;
    state.innerHTML = assignableUsers.length && (this.data?.zones || []).length
      ? `<i class="fas fa-check-circle"></i> ${assignableUsers.length} utilisateur(s) assignable(s) · ${(this.data.zones || []).length} zone(s) disponible(s). Les affectations et permissions affichées proviennent du serveur central.`
      : `<i class="fas fa-exclamation-triangle"></i> ${!assignableUsers.length ? 'Aucun utilisateur non administrateur n’est disponible dans la base centrale. ' : ''}${!(this.data?.zones || []).length ? 'Aucune zone n’est disponible. ' : ''}Utilisez « Actualiser » après avoir créé/importé les comptes ou les zones.`;
    form.prepend(state);

    if (userSelect) userSelect.disabled = !assignableUsers.length;
    if (zoneSelect) zoneSelect.disabled = !(this.data?.zones || []).length;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !assignableUsers.length || !(this.data?.zones || []).length;
  };

  Object.defineProperty(ZoneAccessManager.prototype, PATCH, { value:true });
}

if (typeof window !== 'undefined') window.ZoneAccessRuntimeFix = Object.freeze({ version:ZONE_ACCESS_RUNTIME_FIX_VERSION, recoverAdminUsers });

export { recoverAdminUsers };
