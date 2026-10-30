import ScreensDiagnostic from './screens-diagnostic.js';

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

ScreensDiagnostic.prototype.renderIssuesList = function renderIssuesListSafe() {
  return `
    <table class="issues-table">
      <thead><tr><th>Problème</th><th>Écrans concernés</th><th>Solutions</th><th>Étapes</th><th></th></tr></thead>
      <tbody>
        ${this.issues.map(issue => `
          <tr>
            <td><strong>${esc(issue.name)}</strong><br><small>${esc(issue.description)}</small></td>
            <td>${esc(this.getIssueScreensLabel(issue))}</td>
            <td>${Number(issue.solutions?.length || 0)} solution(s)</td>
            <td>${Number(issue.steps?.length || 0)} étape(s)</td>
            <td class="actions">
              <button class="btn-icon edit-issue" data-id="${esc(issue.id)}"><i class="fas fa-edit"></i></button>
              <button class="btn-icon delete-issue" data-id="${esc(issue.id)}"><i class="fas fa-trash"></i></button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
};

ScreensDiagnostic.prototype.renderDiagnosisFlow = function renderDiagnosisFlowSafe() {
  const currentIssue = this.currentDiagnosis;
  const currentStep = currentIssue.steps[this.currentStep];
  const progress = currentIssue.steps.length ? (this.currentStep / currentIssue.steps.length) * 100 : 0;
  return `
    <div class="diagnosis-flow">
      <div class="diagnosis-header">
        <h3>Diagnostic: ${esc(currentIssue.name)}</h3>
        <div class="breadcrumb">${this.selectedScreens.map(screen => `<span class="screen-tag">${esc(screen.name)}</span>`).join('')}</div>
        <div class="progress"><div class="progress-bar" style="width:${progress}%"></div><span>Étape ${this.currentStep + 1} sur ${currentIssue.steps.length}</span></div>
      </div>
      <div class="step-content">
        <h4>${esc(currentStep.question)}</h4>
        ${this.renderStepInput(currentStep)}
        ${currentStep.image ? `<div class="step-image"><img src="${esc(currentStep.image)}" alt="Illustration"></div>` : ''}
        ${currentStep.relatedDevices?.length ? `<div class="related-devices"><h5>Appareils/câbles associés:</h5><ul>${currentStep.relatedDevices.map(device => `
          <li><i class="fas fa-${device.type === 'cable' ? 'plug' : 'microchip'}"></i> ${esc(device.name)} (${esc(device.location)}) ${device.cableType ? `<span class="cable-type">${esc(device.cableType)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      </div>
      <div class="step-actions">
        ${this.currentStep > 0 ? '<button id="prev-step-btn" class="btn gray">Précédent</button>' : ''}
        <button id="next-step-btn" class="btn btn-primary">${this.currentStep === currentIssue.steps.length - 1 ? 'Terminer le diagnostic' : 'Suivant'}</button>
        <button id="cancel-diagnosis-btn" class="btn danger">Annuler</button>
      </div>
    </div>`;
};

ScreensDiagnostic.prototype.renderStepInput = function renderStepInputSafe(step) {
  if (step.type === 'options' && Array.isArray(step.options)) {
    return `<select id="diagnosis-step-value" class="form-control">${step.options.map(option => `<option value="${esc(option)}">${esc(option)}</option>`).join('')}</select>`;
  }
  if (step.type === 'boolean') return '<select id="diagnosis-step-value" class="form-control"><option value="oui">Oui</option><option value="non">Non</option></select>';
  return '<textarea id="diagnosis-step-value" class="form-control" placeholder="Observation du technicien"></textarea>';
};

export { esc as escapeDiagnosticHtml };
