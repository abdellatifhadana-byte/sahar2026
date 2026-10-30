import TechUISmart from './techui.js';
import { startupLogoMarkup } from './startup-splash.js';

const PATCH = Symbol.for('2m-tech.tech-loading-brand');
if (!TechUISmart.prototype[PATCH]) {
  TechUISmart.prototype.renderLoading = function renderBrandedTechnicianLoading() {
    return `<div class="tech-loading-screen branded-tech-loading" role="status" aria-live="polite">
      <div class="tech-loader branded-tech-loader">
        <div class="startup-logo-wrap tech-startup-logo">${startupLogoMarkup({ compact:true })}<div class="startup-scan-line" aria-hidden="true"></div></div>
        <strong>2M TECH PLATFORM</strong>
        <div>Chargement de l’espace technicien…</div>
        <small>Préparation des équipements, tickets, diagnostics et données de salle.</small>
      </div>
    </div>`;
  };
  Object.defineProperty(TechUISmart.prototype, PATCH, { value:true });
}

export default TechUISmart;
