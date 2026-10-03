import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { MessageCircle, X, Send, Loader2, Mic, MicOff, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

export default function VirtualAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        // Auto-submit after 3 seconds of silence
        silenceTimerRef.current = setTimeout(() => {
          if (recognitionRef.current && isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
            if (transcript.trim()) {
              // We use a ref wrapper or form submit to avoid stale closure issues, 
              // but for simplicity, we trigger the button click.
              document.getElementById("gemma-send-btn")?.click();
            }
          }
        }, 3000);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      };

      recognitionRef.current.onend = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      };
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [isListening]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;
    
    const userMessage = { role: "user", content: input.trim() };
    const chatHistory = [...messages, userMessage];
    
    setMessages(chatHistory);
    setInput("");
    setLoading(true);

    try {
      // ATTEMPT TO CALL REAL SUPABASE EDGE FUNCTION
      const { data, error } = await supabase.functions.invoke('chat-ai', {
        body: { messages: chatHistory }
      });

      if (error || !data?.reply) {
        throw new Error("AI Endpoint not ready.");
      }

      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);

    } catch (err) {
      console.warn("AI Backend Error:", err.message);
      
      // SMART FALLBACK: Simulated response if Edge Function isn't deployed yet
      setTimeout(() => {
        setMessages(prev => [...prev, { 
          role: "assistant", 
          content: "I'm currently in **offline mode** because my AI backend hasn't been deployed yet!\n\nOnce you link my Supabase Edge Function to OpenAI, I'll be able to help you manage clients, generate quotes, and track projects. Let me know when I'm plugged in!" 
        }]);
        setLoading(false);
      }, 1200);
    } finally {
      setLoading(false);
    }
  };

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      toast.error('Voice recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    } else {
      setInput('');
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-slate-900 text-amber-400 shadow-2xl hover:shadow-amber-500/20 hover:scale-110 transition-all duration-300 flex items-center justify-center group border-2 border-amber-400/20"
        >
          <Bot className="h-6 w-6 group-hover:scale-110 transition-transform" />
        </button>
      )}

      {/* Chat Window */}
      {open && (
        <Card className="fixed bottom-6 right-6 z-50 w-[380px] h-[600px] flex flex-col shadow-2xl border border-slate-200 bg-white animate-in slide-in-from-bottom-4 duration-300 overflow-hidden rounded-2xl">
          
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center shadow-sm">
                <Bot className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-900">Gemma AI</h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Virtual Assistant</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="h-16 w-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4 border border-amber-200 shadow-sm">
                  <Bot className="h-8 w-8 text-amber-600" />
                </div>
                <p className="text-sm font-black text-slate-800 mb-2">Hi, I'm Gemma!</p>
                <p className="text-xs font-medium text-slate-500 px-4 leading-relaxed">
                  I can help you create clients, look up estimates, or manage projects. Type your question or use the microphone to speak!
                </p>
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === "user" 
                    ? "bg-slate-900 text-white rounded-br-sm" 
                    : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm"
                }`}>
                  {msg.role === "user" ? (
                    <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="text-sm prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-50 prose-pre:text-slate-800 prose-pre:border prose-pre:border-slate-200 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 border border-slate-200 shadow-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span className="text-xs font-bold text-slate-400">Gemma is thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-slate-100 bg-white">
            <form onSubmit={handleSend} className="flex gap-2">
              <Button
                type="button"
                onClick={toggleVoiceInput}
                disabled={loading}
                className={`h-11 w-11 rounded-xl shrink-0 transition-all ${
                  isListening 
                    ? "bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-md shadow-red-500/20" 
                    : "bg-slate-100 hover:bg-slate-200 text-slate-500"
                }`}
              >
                {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask Gemma anything..."}
                disabled={loading || isListening}
                className="flex-1 h-11 rounded-xl border-slate-200 focus:border-amber-400 font-medium bg-slate-50 shadow-inner"
              />
              
              <Button 
                id="gemma-send-btn"
                type="submit" 
                disabled={loading || !input.trim()}
                className="h-11 w-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-900 shrink-0 shadow-sm"
              >
                <Send className="h-5 w-5 ml-0.5" />
              </Button>
            </form>
          </div>
        </Card>
      )}
    </>
  );
}