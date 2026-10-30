import ScreensDiagnostic from './screens-diagnostic.js';

const PATCH_FLAG = Symbol.for('2m-tech.screens-diagnostic-host-integration.v1');

function resolveDiagnosticHost(instance) {
  if (instance?.hostElementId) {
    const explicit = document.getElementById(instance.hostElementId);
    if (explicit) return explicit;
  }
  return document.getElementById('responsible-screen-diagnostic')
    || document.getElementById('admin-content')
    || document.getElementById('responsible-content')
    || document.getElementById('app');
}

if (!ScreensDiagnostic.prototype[PATCH_FLAG]) {
  ScreensDiagnostic.prototype.resolveRenderHost = function resolveRenderHost() {
    return resolveDiagnosticHost(this);
  };

  ScreensDiagnostic.prototype.refreshView = async function refreshViewInCanonicalHost() {
    const container = this.resolveRenderHost();
    if (!container) return;
    container.innerHTML = await this.render();
    await this.afterRender();
  };

  Object.defineProperty(ScreensDiagnostic.prototype, PATCH_FLAG, { value:true });
}

export { resolveDiagnosticHost };
