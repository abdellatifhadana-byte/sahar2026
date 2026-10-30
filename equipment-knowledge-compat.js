function adaptKnowledgeDialogs(root = document) {
  root.querySelectorAll?.('.kb-modal').forEach(node => {
    node.classList.add('modal');
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    node.style.justifyContent = 'center';
  });
  root.querySelectorAll?.('.kb-modal-card').forEach(node => node.classList.add('modal-content'));
  root.querySelectorAll?.('.kb-close').forEach(node => node.classList.add('close-modal'));
  root.querySelectorAll?.('.kb-form-grid').forEach(node => {
    node.style.display = 'grid';
    node.style.gridTemplateColumns = 'repeat(auto-fit,minmax(220px,1fr))';
    node.style.gap = '10px';
  });
  root.querySelectorAll?.('.kb-actions').forEach(node => {
    node.style.display = 'flex';
    node.style.justifyContent = 'flex-end';
    node.style.gap = '8px';
  });
}

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) adaptKnowledgeDialogs(node);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  adaptKnowledgeDialogs();
}

export { adaptKnowledgeDialogs };
