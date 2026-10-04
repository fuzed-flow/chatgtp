import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/api/supabaseClient"; 
import { MessageCircle, X, Send, Bot, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as Dialog from "@radix-ui/react-dialog";
import AIHelpAnswer from "./AIHelpAnswer";

export default function AIHelpWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  
  // 👈 Get the current page URL
  const location = useLocation(); 

  // 1. Updated AI Persona
  const [messages, setMessages] = useState([
    { role: "ai", text: "Hi! I'm the FuzedFlow Helper. What can I help you find today?" }
  ]);

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

  // 2. Hide widget on specific portal pages
  const hiddenRoutes = ["/client", "/contractor", "/public"];
  const isHidden = hiddenRoutes.some(route => location.pathname.toLowerCase().includes(route));

  // 👈 If they are on a hidden route, render nothing
  if (isHidden) return null; 

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput("");
    
    setMessages(prev => [...prev, { role: "user", text: userText }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-help', {
        body: { 
          query: userText,
          // 👇 NEW: Send the current page context to the AI
          currentPath: location.pathname,
          history: messages.slice(1).slice(-6).map(message => ({ role: message.role === "ai" ? "assistant" : "user", content: message.text }))
        },
      });

      if (error) throw error;

      setMessages(prev => [...prev, { role: "ai", text: data.reply || "I couldn't process that request.", sources: Array.isArray(data.sources) ? data.sources.filter(source => /^[a-zA-Z0-9_-]+$/.test(source.slug) && typeof source.question === "string").slice(0, 3) : [] }]);
    } catch (error) {
      console.error("AI Help Error:", error);
      setMessages(prev => [...prev, { role: "ai", text: error.context?.status === 401 ? "Your session has expired. Please sign in again to use AI Help." : "AI Help couldn't connect. You can still use the Knowledge Base & FAQ or contact support below." }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Open AI help"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[calc(env(safe-area-inset-right)+1rem)] z-40 flex h-14 items-center gap-2 rounded-full bg-amber-500 px-4 text-slate-900 shadow-xl touch-manipulation hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:bottom-6 sm:right-6">
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
          <span className="text-sm font-semibold">AI Help</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/40" />
        <Dialog.Content
          style={viewport ? { "--help-viewport-height": `${viewport.height}px`, "--help-keyboard-inset": `${viewport.inset}px` } : undefined}
          className="fixed left-3 right-3 bottom-[calc(var(--help-keyboard-inset,0px)+env(safe-area-inset-bottom)+0.75rem)] z-[61] flex h-[min(34rem,calc(var(--help-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none sm:left-auto sm:right-6 sm:bottom-6 sm:w-[400px] sm:h-[min(36rem,calc(var(--help-viewport-height,100dvh)-3rem))]">
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
                    {msg.role === "ai" ? <><AIHelpAnswer text={msg.text} />{msg.sources?.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-xs font-semibold text-slate-500">Related help</p>{msg.sources.map(source => <Link key={source.slug} to={`/FAQ?article=${encodeURIComponent(source.slug)}`} onClick={() => setIsOpen(false)} className="mt-1 flex min-h-11 items-center rounded-lg px-2 py-2 text-xs font-medium text-amber-800 underline-offset-2 hover:bg-amber-50 hover:underline focus-visible:ring-2 focus-visible:ring-amber-500">{source.question}</Link>)}</div>}</> : msg.text}
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
              <div className="mt-1 grid grid-cols-2 gap-1"><Link to="/FAQ" onClick={() => setIsOpen(false)} className="flex min-h-12 items-center justify-center rounded-lg px-2 text-sm font-medium text-amber-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-manipulation">Knowledge Base</Link><Link to="/Contact" onClick={() => setIsOpen(false)} className="flex min-h-12 items-center justify-center rounded-lg px-2 text-sm font-medium text-amber-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-manipulation">Contact support</Link></div>
            </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
