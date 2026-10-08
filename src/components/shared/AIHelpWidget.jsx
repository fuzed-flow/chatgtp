import React, { useCallback, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/api/supabaseClient"; 
import { MessageCircle, X, Send, Bot, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as Dialog from "@radix-ui/react-dialog";
import AIHelpAnswer from "./AIHelpAnswer";
import { isPublicHelpRoute } from "@/lib/helpPortal";
import { useAuth } from "@/lib/AuthContext";
import { isAllowedHelpLink } from "../../../supabase/functions/_shared/helpLinks.js";
import { useAIHelp } from "./AIHelpContext";

const GREETING = { role: "ai", text: "Hi! I'm the FuzedFlow Helper. What can I help you find today?" };
const MOBILE_DRAG_QUERY = "(max-width: 767px), ((pointer: coarse) and (max-width: 1023px))";
const MOBILE_DRAG_HOLD_MS = 350;
const MOBILE_DRAG_TOLERANCE = 8;
const MOBILE_DRAG_EDGE = 8;
const MOBILE_POSITION_KEY = "fuzedflow.ai-help.mobile-position";

const isMobileDragViewport = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(MOBILE_DRAG_QUERY).matches ?? window.innerWidth < 768;
};

const clampMobilePosition = (position, buttonWidth, buttonHeight) => {
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const viewportBottom = viewportTop + viewportHeight;
  const mobileNavigationRect = document
    .querySelector('[data-mobile-navigation], [aria-label="Primary mobile navigation"], [aria-label="Employee portal mobile navigation"]')
    ?.getBoundingClientRect();
  const unobstructedBottom = Number.isFinite(mobileNavigationRect?.top) && mobileNavigationRect.top > viewportTop
    ? Math.min(viewportBottom, mobileNavigationRect.top)
    : viewportBottom;
  const minX = viewportLeft + MOBILE_DRAG_EDGE;
  const minY = viewportTop + MOBILE_DRAG_EDGE;
  const maxX = Math.max(minX, viewportLeft + viewportWidth - buttonWidth - MOBILE_DRAG_EDGE);
  const maxY = Math.max(minY, unobstructedBottom - buttonHeight - MOBILE_DRAG_EDGE);
  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  };
};

const readSavedMobilePosition = () => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(MOBILE_POSITION_KEY));
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
  } catch {
    return null;
  }
};

export default function AIHelpWidget() {
  const { profile } = useAuth();
  const { isDialogOpen, registerOpenHelp } = useAIHelp();
  const conversationScope = `${profile?.id || ''}:${profile?.role || ''}`;
  const scopeRef = useRef(conversationScope);
  const requestGenerationRef = useRef(0);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const triggerRef = useRef(null);
  const dragSessionRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const suppressOpenRef = useRef(false);
  const returnFocusTargetRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  const [canDragOnMobile, setCanDragOnMobile] = useState(isMobileDragViewport);
  const [mobilePosition, setMobilePosition] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // 👈 Get the current page URL
  const location = useLocation(); 
  const isHidden = isPublicHelpRoute(location.pathname);

  // 1. Updated AI Persona
  const [messages, setMessages] = useState([GREETING]);

  const restoreFocusToDialogTrigger = useCallback(() => {
    const target = returnFocusTargetRef.current;
    returnFocusTargetRef.current = null;
    if (target && document.contains(target)) window.requestAnimationFrame(() => target.focus());
  }, []);

  const openHelpFromDialog = useCallback(({ returnFocusTarget } = {}) => {
    returnFocusTargetRef.current = returnFocusTarget instanceof HTMLElement ? returnFocusTarget : null;
    setIsOpen(true);
  }, []);

  const handleOpenChange = useCallback((open) => {
    setIsOpen(open);
    if (!open) restoreFocusToDialogTrigger();
  }, [restoreFocusToDialogTrigger]);

  useEffect(() => {
    if (isHidden) return undefined;
    return registerOpenHelp(openHelpFromDialog);
  }, [isHidden, openHelpFromDialog, registerOpenHelp]);

  useEffect(() => {
    scopeRef.current = conversationScope;
    requestGenerationRef.current += 1;
    setMessages([GREETING]);
    setInput("");
    setIsLoading(false);
    setIsOpen(false);
  }, [conversationScope]);

  useEffect(() => {
    if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const visualViewport = window.visualViewport;
    const updateViewport = () => setViewport({
      height: visualViewport?.height ?? window.innerHeight,
      inset: Math.max(0, window.innerHeight - (visualViewport?.height ?? window.innerHeight) - (visualViewport?.offsetTop ?? 0)),
    });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, [isOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(MOBILE_DRAG_QUERY);
    const updateDragAvailability = () => setCanDragOnMobile(isMobileDragViewport());
    updateDragAvailability();
    window.addEventListener("resize", updateDragAvailability);
    mediaQuery?.addEventListener?.("change", updateDragAvailability);
    return () => {
      window.removeEventListener("resize", updateDragAvailability);
      mediaQuery?.removeEventListener?.("change", updateDragAvailability);
    };
  }, []);

  useEffect(() => {
    if (!canDragOnMobile || !triggerRef.current) return;
    const savedPosition = readSavedMobilePosition();
    if (!savedPosition) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMobilePosition(clampMobilePosition(savedPosition, rect.width, rect.height));
  }, [canDragOnMobile]);

  useEffect(() => {
    if (!canDragOnMobile) return;
    const keepTriggerVisible = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMobilePosition(current => current ? clampMobilePosition(current, rect.width, rect.height) : current);
    };
    window.addEventListener("resize", keepTriggerVisible);
    window.visualViewport?.addEventListener("resize", keepTriggerVisible);
    window.visualViewport?.addEventListener("scroll", keepTriggerVisible);
    return () => {
      window.removeEventListener("resize", keepTriggerVisible);
      window.visualViewport?.removeEventListener("resize", keepTriggerVisible);
      window.visualViewport?.removeEventListener("scroll", keepTriggerVisible);
    };
  }, [canDragOnMobile]);

  useEffect(() => () => window.clearTimeout(longPressTimerRef.current), []);

  const clearLongPressTimer = () => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const suppressNextOpen = () => {
    suppressOpenRef.current = true;
    window.setTimeout(() => { suppressOpenRef.current = false; }, 0);
  };

  const handleTriggerPointerDown = (event) => {
    if (!canDragOnMobile || event.button !== 0 || event.isPrimary === false) return;
    clearLongPressTimer();
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const rect = element.getBoundingClientRect();
    dragSessionRef.current = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: rect.left,
      initialY: rect.top,
      buttonWidth: rect.width,
      buttonHeight: rect.height,
      activated: false,
      movedBeforeHold: false,
      position: null,
      element,
    };
    try { element.setPointerCapture?.(pointerId); } catch { /* Pointer capture is optional on older mobile browsers. */ }
    longPressTimerRef.current = window.setTimeout(() => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== pointerId || session.movedBeforeHold) return;
      session.activated = true;
      suppressOpenRef.current = true;
      session.position = clampMobilePosition({ x: session.initialX, y: session.initialY }, session.buttonWidth, session.buttonHeight);
      setMobilePosition(session.position);
      setIsDragging(true);
    }, MOBILE_DRAG_HOLD_MS);
  };

  const handleTriggerPointerMove = (event) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (!session.activated) {
      if (Math.hypot(deltaX, deltaY) > MOBILE_DRAG_TOLERANCE) {
        session.movedBeforeHold = true;
        clearLongPressTimer();
      }
      return;
    }
    event.preventDefault();
    session.position = clampMobilePosition({
      x: session.initialX + deltaX,
      y: session.initialY + deltaY,
    }, session.buttonWidth, session.buttonHeight);
    setMobilePosition(session.position);
  };

  const finishTriggerPointerInteraction = (event) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    if (session.activated) {
      event.preventDefault();
      setIsDragging(false);
      try { if (session.position) window.sessionStorage.setItem(MOBILE_POSITION_KEY, JSON.stringify(session.position)); } catch { /* Storage may be unavailable in a private browser context. */ }
      suppressNextOpen();
    } else if (session.movedBeforeHold) {
      suppressNextOpen();
    }
    try {
      if (session.element.hasPointerCapture?.(session.pointerId)) session.element.releasePointerCapture(session.pointerId);
    } catch { /* The browser may already have released pointer capture. */ }
    dragSessionRef.current = null;
  };

  const handleTriggerClick = (event) => {
    if (!suppressOpenRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressOpenRef.current = false;
  };

  // 👈 If they are on a hidden route, render nothing
  if (isHidden) return null; 

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const requestScope = conversationScope;
    const requestGeneration = ++requestGenerationRef.current;
    const currentRequest = () => scopeRef.current === requestScope && requestGenerationRef.current === requestGeneration;
    setInput("");
    
    setMessages(prev => [...prev, { role: "user", text: userText }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-help', {
        body: { 
          query: userText,
          // 👇 NEW: Send the current page context to the AI
          currentPath: location.pathname + location.search,
          history: messages.slice(1).slice(-6).map(message => ({ role: message.role === "ai" ? "assistant" : "user", content: message.text }))
        },
      });

      if (error) throw error;
      if (!currentRequest()) return;
      const allowedLinks = Array.isArray(data?.allowedLinks) ? data.allowedLinks.filter(link => link && typeof link.href === 'string' && isAllowedHelpLink(link.href, data.allowedLinks)).map(link => ({ href: link.href, label: typeof link.label === 'string' ? link.label : '' })) : [];
      const sources = Array.isArray(data?.sources) ? data.sources.filter(source => source && /^[a-zA-Z0-9_-]{1,160}$/.test(source.slug) && typeof source.question === "string" && isAllowedHelpLink(`/HelpArticles?article=${source.slug}`, allowedLinks)).slice(0, 3) : [];
      setMessages(prev => [...prev, { role: "ai", text: typeof data?.reply === 'string' ? data.reply : "I couldn't process that request.", allowedLinks, sources }]);
    } catch (error) {
      if (!currentRequest()) return;
      console.error("AI Help Error:", error);
      setMessages(prev => [...prev, { role: "ai", text: error.context?.status === 401 ? "Your session has expired. Please sign in again to use AI Help." : "AI Help couldn't connect. You can still use the Help Articles or contact support below." }]);
    } finally {
      if (currentRequest()) setIsLoading(false);
    }
  };
  
  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button ref={triggerRef} type="button" aria-label="Open AI help" aria-describedby={canDragOnMobile ? "ai-help-drag-instructions" : undefined}
          data-dragging={isDragging ? "true" : "false"}
          title={canDragOnMobile ? "Tap for AI Help. Press and hold to move." : "Open AI Help"}
          style={canDragOnMobile && mobilePosition ? { left: `${mobilePosition.x}px`, top: `${mobilePosition.y}px`, right: "auto", bottom: "auto" } : undefined}
          onPointerDown={handleTriggerPointerDown}
          onPointerMove={handleTriggerPointerMove}
          onPointerUp={finishTriggerPointerInteraction}
          onPointerCancel={finishTriggerPointerInteraction}
          onClick={handleTriggerClick}
          onContextMenu={(event) => { if (canDragOnMobile) event.preventDefault(); }}
          className={`fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-[calc(env(safe-area-inset-right)+1rem)] z-[115] flex h-14 w-14 select-none items-center justify-center gap-0 rounded-full bg-amber-500 px-0 text-slate-900 shadow-xl transition-[background-color,box-shadow,transform] hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:w-auto sm:gap-2 sm:px-4 lg:bottom-6 lg:right-6 ${isDialogOpen ? "pointer-events-none scale-95 opacity-0" : ""} ${canDragOnMobile ? "touch-none" : "touch-manipulation"} ${isDragging ? "cursor-grabbing scale-[1.04] shadow-2xl ring-4 ring-amber-200" : canDragOnMobile ? "cursor-grab" : ""}`}>
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
          <span className="hidden text-sm font-semibold sm:inline">AI Help</span>
          {canDragOnMobile && <span id="ai-help-drag-instructions" className="sr-only">Tap to open. Press and hold, then drag to move this button.</span>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[250] bg-slate-950/40" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            if (!returnFocusTargetRef.current) return;
            event.preventDefault();
            restoreFocusToDialogTrigger();
          }}
          style={viewport ? { "--help-viewport-height": `${viewport.height}px`, "--help-keyboard-inset": `${viewport.inset}px` } : undefined}
          className="fixed left-3 right-3 bottom-[calc(var(--help-keyboard-inset,0px)+env(safe-area-inset-bottom)+0.75rem)] z-[260] flex h-[min(34rem,calc(var(--help-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none sm:left-auto sm:right-6 sm:bottom-6 sm:w-[400px] sm:h-[min(36rem,calc(var(--help-viewport-height,100dvh)-3rem))]">
            <div className="bg-slate-900 text-white px-3 py-2 flex justify-between items-center gap-2 shrink-0">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="h-5 w-5 text-amber-400" />
                <Dialog.Title className="font-semibold text-sm">FuzedFlow Helper</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close AI help" className="h-12 w-12 shrink-0 touch-manipulation text-slate-200 hover:text-white hover:bg-slate-800 rounded-full">
                  <X className="h-6 w-6" aria-hidden="true" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Ask for help using FuzedFlow or contact support.</Dialog.Description>

            <div ref={messageListRef} role="log" aria-label="Help conversation" aria-live="polite" aria-busy={isLoading} className="flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto overscroll-contain bg-slate-50 space-y-4 custom-scrollbar">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === "user" ? "max-w-[85%] ml-auto flex-row-reverse" : "max-w-full"}`}>
                  <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${msg.role === "user" ? "bg-amber-500 text-slate-900" : "bg-amber-100 text-amber-800"}`}>
                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={`min-w-0 break-words [overflow-wrap:anywhere] p-3 rounded-2xl text-sm ${msg.role === "user" ? "bg-amber-100 text-slate-900 rounded-tr-sm whitespace-pre-wrap" : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"}`}>
                    {msg.role === "ai" ? <><AIHelpAnswer text={msg.text} allowedLinks={msg.allowedLinks} onLinkClick={() => setIsOpen(false)} />{msg.sources?.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-xs font-semibold text-slate-500">Related help</p>{msg.sources.map(source => <Link key={source.slug} to={isAllowedHelpLink(`/HelpArticles?article=${source.slug}`, msg.allowedLinks)} onClick={() => setIsOpen(false)} className="mt-1 flex min-h-11 items-center rounded-lg px-2 py-2 text-xs font-medium text-amber-800 underline-offset-2 hover:bg-amber-50 hover:underline focus-visible:ring-2 focus-visible:ring-amber-500">{source.question}</Link>)}</div>}</> : msg.text}
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-3 max-w-[85%]">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center"><Bot className="h-4 w-4" /></div>
                  <div className="p-4 rounded-2xl bg-white border border-slate-200 rounded-tl-sm shadow-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-slate-200 shrink-0">
              <form onSubmit={handleSend} className="flex items-center gap-2">
                <Input aria-label="Your question" maxLength={2000} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question..." className="h-12 min-w-0 flex-1 text-base sm:text-base bg-slate-50 border-slate-200 focus-visible:ring-amber-500" disabled={isLoading} />
                <Button type="submit" size="icon" aria-label={isLoading ? "Sending question" : "Send question"} disabled={!input.trim() || isLoading} className="h-12 w-12 touch-manipulation bg-amber-500 text-slate-900 hover:bg-amber-600 shrink-0">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
              <div className="mt-1 grid grid-cols-2 gap-1"><Link to="/HelpArticles" onClick={() => setIsOpen(false)} className="flex min-h-12 items-center justify-center rounded-lg px-2 text-sm font-medium text-amber-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-manipulation">Help Articles</Link><Link to="/Contact" onClick={() => setIsOpen(false)} className="flex min-h-12 items-center justify-center rounded-lg px-2 text-sm font-medium text-amber-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-manipulation">Contact support</Link></div>
            </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
