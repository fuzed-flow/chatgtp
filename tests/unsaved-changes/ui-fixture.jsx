import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
import UnsavedChangesGuard from '../../src/components/shared/UnsavedChangesGuard.jsx';
import { useDocumentChanges, useDocumentState } from '../../src/hooks/useDocumentChanges.js';

window.saveRequests = [];
window.savedSnapshots = [];

function Builder() {
  const changes = useDocumentChanges();
  const [document, setDocument, hydrateDocument] = useDocumentState({ title: 'Existing document', lines: [] }, changes.markDirty);
  const [unrelated, setUnrelated] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  window.documentFixture = {
    edit: title => setDocument(current => ({ ...current, title })),
    hydrate: title => hydrateDocument(current => ({ ...current, title })),
    noChange: () => setDocument(current => ({ ...current, lines: [...current.lines] })),
    addLine: () => setDocument(current => ({ ...current, lines: [...current.lines, { amount: 10 }] })),
    mutateLineThenSet: () => {
      const lines = [...document.lines];
      lines[0].amount = 25;
      setDocument({ ...document, lines });
    },
    addTwoLines: () => {
      setDocument(current => ({ ...current, lines: [...current.lines, { amount: 11 }] }));
      setDocument(current => ({ ...current, lines: [...current.lines, { amount: 12 }] }));
    },
    hydrateLine: () => hydrateDocument(current => ({ ...current, lines: [{ amount: 10 }] })),
    navigate: path => navigate(path),
    replace: path => navigate(path, { replace: true }),
    back: () => navigate(-1),
    dirty: () => changes.isDirty,
    revision: changes.getRevision,
    saveThenNavigate: path => {
      const saved = changes.markSaved(changes.getRevision());
      if (saved) navigate(path);
      return saved;
    },
    beginOrdinarySave: async () => {
      const revision = changes.getRevision();
      const snapshot = { ...document };
      setSaving(true);
      try {
        const result = await new Promise((resolve, reject) => window.saveRequests.push({ resolve, reject, snapshot }));
        if (!result) return null;
        window.savedSnapshots.push(snapshot);
        if (window.fixtureSkipCleanSave) return result;
        return changes.markSaved(revision) ? result : null;
      } finally { setSaving(false); }
    },
  };
  const onSave = window.documentFixture.beginOrdinarySave;
  return <>
    <main>
      <h1>Quote builder</h1>
      <label htmlFor="document-title">Document title</label>
      <input id="document-title" value={document.title} onChange={event => setDocument(current => ({ ...current, title: event.target.value }))} />
      <label htmlFor="unrelated-search">Unrelated search</label>
      <input id="unrelated-search" value={unrelated} onChange={event => setUnrelated(event.target.value)} />
      <output aria-label="Dirty state">{changes.isDirty ? 'Unsaved' : 'Saved'}</output>
      <output aria-label="Line count">{document.lines.length}</output>
      <output aria-label="Line amounts">{document.lines.map(line => line.amount).join(',')}</output>
      <button onClick={window.documentFixture.addLine}>Add line</button>
      <Link to="/Dashboard">Dashboard link</Link>
      <button onClick={() => navigate('/Dashboard')}>Open dashboard</button>
      <button onClick={() => navigate(-1)}>Go back</button>
      <a href="https://outside.example/leave">External link</a>
      <a href="/Reports" data-document-navigation="true">Full document link</a>
      <a href="https://outside.example/new" target="_blank" rel="noreferrer">New tab</a>
      <a href="/export.pdf" download>Download document</a>
      <a href="#details">Details anchor</a>
      <section id="details">Details</section>
    </main>
    <UnsavedChangesGuard isDirty={changes.isDirty} hasUnsavedChanges={changes.hasUnsavedChanges} saving={saving} onSave={onSave} documentName={window.fixtureDocumentName || 'quote'} />
  </>;
}

function OtherPage({ name }) {
  return <main><h1>{name}</h1><Link to="/QuoteBuilder?id=existing">Return to builder</Link></main>;
}

window.fixtureRouter = createMemoryRouter([
  { path: '/QuoteBuilder', element: <Builder /> },
  { path: '/Dashboard', element: <OtherPage name="Dashboard" /> },
  { path: '/Reports', element: <OtherPage name="Reports" /> },
], { initialEntries: ['/Dashboard', '/QuoteBuilder?id=existing'], initialIndex: 1 });
createRoot(document.getElementById('root')).render(<RouterProvider router={window.fixtureRouter} />);
