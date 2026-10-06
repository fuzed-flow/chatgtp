import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function resetScrollContainer(container) {
  if (!container) return;
  container.scrollTop = 0;
  container.scrollLeft = 0;
}

export function lockDocumentScroll(doc) {
  const root = doc?.documentElement;
  if (!root) return () => {};

  const alreadyLocked = root.classList.contains("app-scroll-locked");
  root.classList.add("app-scroll-locked");

  return () => {
    if (!alreadyLocked) root.classList.remove("app-scroll-locked");
  };
}

export function useRouteScrollReset() {
  const scrollContainerRef = useRef(null);
  const { pathname, search } = useLocation();

  useLayoutEffect(() => lockDocumentScroll(document), []);

  useLayoutEffect(() => {
    resetScrollContainer(scrollContainerRef.current);
  }, [pathname, search]);

  return scrollContainerRef;
}
