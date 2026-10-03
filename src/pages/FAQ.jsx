import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { 
  FileQuestion, 
  ChevronDown, 
  Calculator, 
  CreditCard, 
  HardHat, 
  Users,
  Search,
  Loader2,
  HelpCircle
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function FAQ() {
  const [faqs, setFaqs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [openIndex, setOpenIndex] = useState(null);

  // 1. Fetch live FAQs from the database
  useEffect(() => {
    const fetchFaqs = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("help_faqs")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: false });

      if (!error && data) {
        setFaqs(data);
        const initialCategories = [...new Set(data.map(f => f.feature_area))];
        if (initialCategories.length > 0) setActiveCategory(initialCategories[0]);
      }
      setIsLoading(false);
    };
    fetchFaqs();
  }, []);

  // 2. Filter logic for the search bar
  const filteredFaqs = faqs.filter(faq => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const searchTermsMatch = faq.search_terms && faq.search_terms.some(term => term.toLowerCase().includes(query));
    
    return (
      faq.question.toLowerCase().includes(query) ||
      faq.answer_short.toLowerCase().includes(query) ||
      searchTermsMatch
    );
  });

  // 3. Dynamic grouping based on active search results
  const categories = [...new Set(filteredFaqs.map(f => f.feature_area))];
  const currentQuestions = filteredFaqs.filter(f => f.feature_area === activeCategory);

  const getCategoryIcon = (category) => {
    const cat = category?.toLowerCase() || "";
    if (cat.includes("quote") || cat.includes("estimat")) return <Calculator className="h-4 w-4 mr-2" />;
    if (cat.includes("payment") || cat.includes("invoice")) return <CreditCard className="h-4 w-4 mr-2" />;
    if (cat.includes("project") || cat.includes("material")) return <HardHat className="h-4 w-4 mr-2" />;
    if (cat.includes("team") || cat.includes("account") || cat.includes("client")) return <Users className="h-4 w-4 mr-2" />;
    return <HelpCircle className="h-4 w-4 mr-2" />;
  };

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
          <FileQuestion className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-3xl font-black text-slate-900">
          Frequently Asked Questions
        </h1>
        <p className="text-slate-500 font-medium text-lg">
          Everything you need to know about estimating, billing, and managing your projects with FuzedFlow.
        </p>
      </div>

      {/* Search Bar */}
      <div className="max-w-xl mx-auto relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
        <Input
          type="text"
          placeholder="Search for answers..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setOpenIndex(null);
            // Ensure the active tab switches if the current one is filtered out
            const newFiltered = faqs.filter(faq => {
              const query = e.target.value.toLowerCase();
              return faq.question.toLowerCase().includes(query) || faq.answer_short.toLowerCase().includes(query) || (faq.search_terms && faq.search_terms.some(t => t.toLowerCase().includes(query)));
            });
            const newCats = [...new Set(newFiltered.map(f => f.feature_area))];
            if (newCats.length > 0 && !newCats.includes(activeCategory)) {
              setActiveCategory(newCats[0]);
            }
          }}
          className="pl-10 h-12 text-base border-slate-200 focus-visible:ring-amber-500 rounded-xl bg-white shadow-sm"
        />
      </div>

      {/* Category Tabs */}
      {categories.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => {
                setActiveCategory(category);
                setOpenIndex(null);
              }}
              className={`flex items-center px-4 py-2 rounded-full font-bold text-sm transition-all duration-200 ${
                activeCategory === category
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {getCategoryIcon(category)}
              {category}
            </button>
          ))}
        </div>
      )}

      {/* Content Area */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
        </div>
      ) : filteredFaqs.length === 0 ? (
        <div className="text-center py-12 text-slate-500 bg-white border border-slate-200 rounded-xl shadow-sm">
          No results found for "{searchQuery}". Try adjusting your keywords.
        </div>
      ) : (
        <div className="space-y-3 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
          {currentQuestions.map((faq, i) => (
            <Card 
              key={faq.id} 
              className="border-slate-200 overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => toggleFAQ(i)}
                className="w-full p-5 flex items-center justify-between text-left focus:outline-none hover:bg-slate-50 transition-colors"
              >
                <h3 className="font-bold text-slate-900 text-[17px] pr-4">{faq.question}</h3>
                <ChevronDown 
                  className={`h-5 w-5 text-slate-400 shrink-0 transition-transform duration-200 ${
                    openIndex === i ? "rotate-180 text-amber-500" : ""
                  }`} 
                />
              </button>
              
              {/* CSS Grid hack prevents tall answers from getting cut off */}
              <div 
                className={`grid transition-all duration-300 ease-in-out ${
                  openIndex === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="text-slate-600 leading-relaxed font-medium px-5 pb-5">
                    {faq.answer_short}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Support Footer */}
      <div className="text-center pt-8 border-t border-slate-200 mt-12">
        <h4 className="text-lg font-bold text-slate-900">Still have questions?</h4>
        <p className="text-slate-500 mt-2 mb-4">Can't find the answer you're looking for? We're here to help.</p>
        <Link 
          to="/Contact"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-sm font-bold rounded-md shadow-sm text-slate-900 bg-amber-500 hover:bg-amber-600 transition-colors"
        >
          Contact Support
        </Link>
      </div>

    </div>
  );
}