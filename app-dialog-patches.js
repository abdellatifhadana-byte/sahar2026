import ScreensDiagnostic from './screens-diagnostic.js';

const originalShowIssueForm = ScreensDiagnostic.prototype.showIssueForm;

ScreensDiagnostic.prototype.showIssueForm = async function showIssueFormWithAppDialog(issue = null) {
  const dialog = window.AppDialog;
  if (!dialog?.prompt || typeof originalShowIssueForm !== 'function') return originalShowIssueForm?.call(this, issue);

  const name = await dialog.prompt('Nom du problème', issue?.name || '');
  if (name === null || !String(name).trim()) return;

  const description = await dialog.prompt('Description', issue?.description || '');
  if (description === null) return;

  // Le code métier existant reste la source de vérité. On lui fournit simplement
  // les deux réponses déjà validées afin qu'aucune fenêtre native ne soit ouverte.
  const bridgePrompt = window.prompt;
  const answers = [String(name), String(description)];
  let index = 0;
  let result;
  try {
    window.prompt = () => answers[index++] ?? null;
    result = originalShowIssueForm.call(this, issue);
  } finally {
    // Les deux prompt() originaux sont exécutés avant le premier await.
    // Restaurer immédiatement évite tout effet global pendant l'enregistrement DB.
    window.prompt = bridgePrompt;
  }
  return result;
};
