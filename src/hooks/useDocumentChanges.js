import { useCallback, useRef, useState } from "react";

// Revisions change synchronously, including edits made while a save is pending.
export function useDocumentChanges() {
  const revision = useRef(0);
  const dirty = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = useCallback(() => {
    revision.current += 1;
    dirty.current = true;
    setIsDirty(true);
  }, []);

  const getRevision = useCallback(() => revision.current, []);
  const hasUnsavedChanges = useCallback(() => dirty.current, []);

  const markSaved = useCallback((savedRevision) => {
    if (savedRevision !== revision.current) return false;
    dirty.current = false;
    setIsDirty(false);
    return true;
  }, []);

  return { isDirty, markDirty, markSaved, getRevision, hasUnsavedChanges };
}

function serialize(value) {
  return JSON.stringify(value);
}

// Keep the prior serialized value separately: legacy builder handlers sometimes
// copy an array after editing a nested item, which also mutates the old value.
export function useDocumentState(initialValue, markDirty) {
  const [state, setState] = useState(() => ({
    value: typeof initialValue === "function" ? initialValue() : initialValue,
  }));
  const snapshot = useRef(null);
  if (snapshot.current === null) {
    snapshot.current = { value: state.value, serialized: serialize(state.value) };
  }

  const update = useCallback((nextValue, trackChanges) => {
    const previous = snapshot.current;
    const value = typeof nextValue === "function"
      ? nextValue(previous.value)
      : nextValue;
    const serialized = serialize(value);
    const changed = serialized !== previous.serialized;
    snapshot.current = { value, serialized };
    if (trackChanges && changed) markDirty();
    if (!changed && Object.is(value, previous.value)) return;
    setState({ value });
  }, [markDirty]);

  const setTrackedValue = useCallback((nextValue) => update(nextValue, true), [update]);
  const hydrateValue = useCallback((nextValue) => update(nextValue, false), [update]);

  return [state.value, setTrackedValue, hydrateValue];
}
