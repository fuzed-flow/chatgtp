import React, { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom"; // 👈 Import useLocation
import { supabase } from "@/api/supabaseClient"; 
import { MessageCircle, X, Send, Bot, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import Draggable from "react-draggable";

export default function AIHelpWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  
  // 👈 Get the current page URL
  const location = useLocation(); 

  // 1. Updated AI Persona
  const [messages, setMessages] = useState([
    { role: "ai", text: "Hi! I'm the FuzedFlow Helper. What can I help you find today?" }
  ]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // 2. Hide widget on specific portal pages
  const hiddenRoutes = ["/client", "/employee", "/contractor", "/public"];
  const isHidden = hiddenRoutes.some(route => location.pathname.toLowerCase().includes(route));

  // 👈 If they are on a hidden route, render nothing
  if (isHidden) return null; 

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userText = input.trim();
    setInput("");
    
    setMessages(prev => [...prev, { role: "user", text: userText }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-help', {
        body: { 
          query: userText,
          // 👇 NEW: Send the current page context to the AI
          currentPath: location.pathname 
        },
      });

      if (error) throw error;

      setMessages(prev => [...prev, { role: "ai", text: data.reply || "I couldn't process that request." }]);
    } catch (error) {
      console.error("AI Help Error:", error);
      setMessages(prev => [...prev, { role: "ai", text: "Sorry, I'm having trouble connecting right now." }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Draggable bounds="parent">
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {isOpen && (
          <Card className="w-[350px] sm:w-[400px] h-[500px] mb-4 shadow-2xl flex flex-col overflow-hidden border-slate-200 animate-in slide-in-from-bottom-5 fade-in duration-200">
            <div className="bg-slate-900 text-white p-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                <h3 className="font-semibold text-sm">FuzedFlow Helper</h3> 
              </div>
              
              {/* NEW: Contact Support Link & Close Button Container */}
              <div className="flex items-center gap-2">
                <a 
                  href="/Contact" 
                  className="text-xs text-slate-300 hover:text-white underline-offset-2 hover:underline transition-all"
                >
                  Contact Support
                </a>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full" onClick={() => setIsOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto bg-slate-50 space-y-4 custom-scrollbar">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>
                  <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={`p-3 rounded-2xl text-sm ${msg.role === "user" ? "bg-blue-600 text-white rounded-tr-sm" : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-3 max-w-[85%]">
                  <div className="shrink-0 h-8 w-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center"><Bot className="h-4 w-4" /></div>
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
                <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question..." className="flex-1 bg-slate-50 border-slate-200 focus-visible:ring-blue-500" disabled={isLoading} />
                <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="bg-blue-600 hover:bg-blue-700 shrink-0">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </div>
          </Card>
        )}

        <button onClick={() => setIsOpen(!isOpen)} className={`cursor-move ${isOpen ? "bg-slate-800 rotate-90" : "bg-slate-900 hover:scale-105"} transition-all duration-200 text-white p-4 rounded-full shadow-xl flex items-center justify-center`}>
          {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        </button>
      </div>
    </Draggable>
  );
}