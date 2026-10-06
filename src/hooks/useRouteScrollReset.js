import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function resetScrollContainer(container) {
  if (!container) return;
  container.scrollTop = 0;
  container.scrollLeft = 0;
}

export function useRouteScrollReset() {
  const scrollContainerRef = useRef(null);
  const { pathname, search } = useLocation();

  useLayoutEffect(() => {
    resetScrollContainer(scrollContainerRef.current);
  }, [pathname, search]);

  return scrollContainerRef;
}
