import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const unavailable = () => {};
const defaultContext = {
  isAvailable: false,
  isDialogOpen: false,
  openHelp: unavailable,
  registerOpenHelp: () => unavailable,
  registerModalDialog: () => unavailable,
};

const AIHelpContext = createContext(defaultContext);

export function AIHelpProvider({ children }) {
  const [openHelpHandler, setOpenHelpHandler] = useState(null);
  const modalDialogIds = useRef(new Set());
  const [modalDialogVersion, setModalDialogVersion] = useState(0);

  const registerOpenHelp = useCallback((handler) => {
    if (typeof handler !== "function") return unavailable;
    setOpenHelpHandler(() => handler);
    return () => {
      setOpenHelpHandler(current => current === handler ? null : current);
    };
  }, []);

  const registerModalDialog = useCallback(() => {
    const id = Symbol("ai-help-modal-dialog");
    modalDialogIds.current.add(id);
    setModalDialogVersion(version => version + 1);
    return () => {
      if (modalDialogIds.current.delete(id)) setModalDialogVersion(version => version + 1);
    };
  }, []);

  const value = useMemo(() => ({
    isAvailable: typeof openHelpHandler === "function",
    isDialogOpen: modalDialogIds.current.size > 0,
    openHelp: (options) => openHelpHandler?.(options),
    registerOpenHelp,
    registerModalDialog,
  }), [modalDialogVersion, openHelpHandler, registerModalDialog, registerOpenHelp]);

  return <AIHelpContext.Provider value={value}>{children}</AIHelpContext.Provider>;
}

export function useAIHelp() {
  return useContext(AIHelpContext);
}
