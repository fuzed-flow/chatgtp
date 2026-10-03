import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle, PlayCircle, MessageCircle, FileQuestion } from "lucide-react";

export default function HelpMenu({ onCloseSidebar }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown if user clicks outside of it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNavigate = (path) => {
    navigate(path);
    setIsOpen(false);
    if (onCloseSidebar) onCloseSidebar(); // Closes sidebar on navigation
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (onCloseSidebar) onCloseSidebar(); // Closes the sidebar when icon is tapped
        }}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all border ${
          isOpen 
            ? "bg-slate-100 border-slate-200 text-slate-900" 
            : "bg-transparent border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Help</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Support Center</p>
          </div>
          
          <div className="p-1">
            <button 
              onClick={() => handleNavigate('/Tutorials')}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors text-left"
            >
              <PlayCircle className="h-4 w-4 text-blue-500" />
              Video Tutorials
            </button>
            
            <button 
              onClick={() => handleNavigate('/FAQ')}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-emerald-600 rounded-lg transition-colors text-left"
            >
              <FileQuestion className="h-4 w-4 text-emerald-500" />
              Knowledge Base / FAQ
            </button>
            
            <button 
              onClick={() => handleNavigate('/Contact')}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-amber-600 rounded-lg transition-colors text-left"
            >
              <MessageCircle className="h-4 w-4 text-amber-500" />
              Contact Support
            </button>
          </div>
        </div>
      )}
    </div>
  );
}