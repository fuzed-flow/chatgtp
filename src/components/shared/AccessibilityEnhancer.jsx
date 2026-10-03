import React, { useEffect } from "react";

export default function AccessibilityEnhancer() {
  useEffect(() => {
    // Add ARIA labels to interactive elements if missing
    const addAriaLabels = () => {
      // Add skip to main content link
      if (!document.querySelector('[aria-label="Skip to main content"]')) {
        const skipLink = document.createElement("a");
        skipLink.href = "#main-content";
        skipLink.setAttribute("aria-label", "Skip to main content");
        skipLink.className = "sr-only focus:not-sr-only fixed top-2 left-2 z-50 bg-slate-900 text-white px-4 py-2 rounded";
        skipLink.textContent = "Skip to main content";
        document.body.insertBefore(skipLink, document.body.firstChild);
      }

      // Ensure all buttons have accessible labels
      document.querySelectorAll("button").forEach((btn) => {
        if (!btn.textContent.trim() && !btn.getAttribute("aria-label") && !btn.getAttribute("title")) {
          const icon = btn.querySelector("svg");
          if (icon) {
            const iconType = icon.getAttribute("data-icon") || "button";
            btn.setAttribute("aria-label", iconType);
          }
        }
      });

      // Add role to interactive divs
      document.querySelectorAll("div[onclick]").forEach((div) => {
        if (!div.getAttribute("role")) {
          div.setAttribute("role", "button");
          div.setAttribute("tabindex", "0");
        }
      });
    };

    addAriaLabels();

    // Keyboard navigation support
    const handleKeyDown = (e) => {
      // Enter/Space on elements with role=button
      if ((e.key === "Enter" || e.key === " ") && e.target.getAttribute("role") === "button") {
        e.preventDefault();
        e.target.click();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Focus visible styles
    const style = document.createElement("style");
    style.textContent = `
      *:focus-visible {
        outline: 3px solid #fbbf24 !important;
        outline-offset: 2px !important;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }
      .focus\\:not-sr-only:focus {
        position: static;
        width: auto;
        height: auto;
        padding: inherit;
        margin: inherit;
        overflow: visible;
        clip: auto;
        white-space: normal;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}