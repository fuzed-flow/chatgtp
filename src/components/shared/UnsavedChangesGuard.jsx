import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function UnsavedChangesGuard({ isDirty, saving, onSave, documentName, hasUnsavedChanges }) {
  const [externalDestination, setExternalDestination] = useState(null);
  const [savingToExit, setSavingToExit] = useState(false);
  const [saveError, setSaveError] = useState("");
  const allowDocumentExit = useRef(false);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ isDirty, saving, onSave, externalDestination, hasUnsavedChanges });
  latest.current = { isDirty, saving, onSave, externalDestination, hasUnsavedChanges };
  const hasDirtyChanges = useCallback(() => (
    typeof latest.current.hasUnsavedChanges === "function"
      ? latest.current.hasUnsavedChanges()
      : latest.current.isDirty
  ), []);

  const shouldBlock = useCallback(({ currentLocation, nextLocation }) => (
    hasDirtyChanges() && !allowDocumentExit.current && (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search
    )
  ), [hasDirtyChanges]);
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  latestBlocker.current = blocker;
  const open = blocker.state === "blocked" || externalDestination !== null;
  const busy = saving || savingToExit;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isDirty) return undefined;
    const beforeUnload = (event) => {
      if (!hasDirtyChanges() || allowDocumentExit.current) return;
      event.preventDefault();
      // Browsers display their own standard message for refresh and tab close.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty, hasDirtyChanges]);

  useEffect(() => {
    const interceptDocumentLink = (event) => {
      if (!hasDirtyChanges() || allowDocumentExit.current || event.defaultPrevented ||
          event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download") ||
          (anchor.target && anchor.target.toLowerCase() !== "_self")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
      const current = new URL(window.location.href);
      const sameDocument = destination.origin === current.origin &&
        destination.pathname === current.pathname && destination.search === current.search;
      if (sameDocument && (anchor.getAttribute("href")?.startsWith("#") || destination.hash)) return;

      // React Router Links have already prevented the default event by this
      // bubbling phase and are handled by useBlocker. Plain anchors need this.
      event.preventDefault();
      setSaveError("");
      setExternalDestination(destination.href);
    };
    document.addEventListener("click", interceptDocumentLink);
    return () => document.removeEventListener("click", interceptDocumentLink);
  }, [hasDirtyChanges]);

  const cancelExit = () => {
    if (saveInFlight.current || latest.current.saving) return;
    setExternalDestination(null);
    setSaveError("");
    if (latestBlocker.current.state === "blocked") {
      const pending = latestBlocker.current;
      // Radix's Cancel also invokes onOpenChange; reset only once.
      latestBlocker.current = { state: "unblocked" };
      pending.reset();
    }
  };

  const saveAndExit = async () => {
    if (saveInFlight.current || latest.current.saving) return;
    saveInFlight.current = true;
    setSavingToExit(true);
    setSaveError("");

    try {
      const saved = await latest.current.onSave();
      if (!mounted.current) return;
      if (!saved || hasDirtyChanges()) {
        setSaveError("Some changes are still unsaved. Cancel to check your document, or try saving again.");
        return;
      }

      const destination = latest.current.externalDestination;
      if (destination !== null) {
        allowDocumentExit.current = true;
        window.location.assign(destination);
      } else if (latestBlocker.current.state === "blocked") {
        latestBlocker.current.proceed();
      }
    } catch {
      if (mounted.current) {
        allowDocumentExit.current = false;
        setSaveError("Your changes could not be saved. Please cancel to check your document, or try again.");
      }
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSavingToExit(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) cancelExit(); }}>
      <AlertDialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border-amber-200 bg-white p-5 sm:p-6">
        <AlertDialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 sm:mx-0" aria-hidden="true">
            <Save className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-xl text-slate-900">Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
            Your {documentName} has unsaved changes. Would you like to save and exit, or cancel to keep editing?
          </AlertDialogDescription>
        </AlertDialogHeader>
        {saveError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>}
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel onClick={cancelExit} disabled={busy} className="mt-0 min-h-12 touch-manipulation rounded-lg">
            Cancel
          </AlertDialogCancel>
          <Button type="button" onClick={saveAndExit} disabled={busy} className="min-h-12 touch-manipulation gap-2 rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-600 focus-visible:ring-amber-500">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Saving…" : "Save and exit"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
