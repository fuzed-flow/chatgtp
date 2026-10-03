import React, { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

// Province name -> abbreviation map
const PROVINCE_MAP = {
  "alberta": "AB", "british columbia": "BC", "manitoba": "MB",
  "new brunswick": "NB", "newfoundland and labrador": "NL", "nova scotia": "NS",
  "ontario": "ON", "prince edward island": "PE", "quebec": "QC", "saskatchewan": "SK",
  "northwest territories": "NT", "nunavut": "NU", "yukon": "YT"
};

export default function AddressAutocomplete({ value, onChange, onSelectParsed, placeholder = "Enter address", className = "" }) {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Sync external value changes
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSuggestions = useCallback(async (search) => {
    if (!search || search.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(search)}&format=json&addressdetails=1&limit=6&countrycodes=ca`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      setSuggestions(data);
      setShowDropdown(true);
    } catch (e) {
      setSuggestions([]);
    }
    setLoading(false);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 400);
  };

  const handleSelect = (item) => {
    const addr = item.address || {};
    
    // 1. Build line1 (Street)
    const line1Parts = [addr.house_number, addr.road].filter(Boolean);
    const line1 = line1Parts.join(" ");
    const displayLine1 = line1 || item.display_name.split(",")[0].trim();

    // 2. Extract remaining parts
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || "";
    const provinceRaw = (addr.state || "").toLowerCase();
    const province = PROVINCE_MAP[provinceRaw] || addr.state || "";
    const postal = (addr.postcode || "").replace(" ", " ").toUpperCase();

    // 3. Construct the clean FULL address for the visual input
    // Looks like: "123 Main St, Calgary, AB T2P 1J9"
    const provincePostal = `${province} ${postal}`.trim();
    const cleanFullAddress = [displayLine1, city, provincePostal].filter(Boolean).join(", ");

    // 4. Update the visual input and trigger onChange with the FULL address
    setQuery(cleanFullAddress);
    onChange(cleanFullAddress);

    // 5. Still pass the perfectly separated data to the parent form if it needs it!
    if (onSelectParsed) {
      onSelectParsed({ line1: displayLine1, city, province, postal });
    }

    setSuggestions([]);
    setShowDropdown(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Input
          value={query}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className={className}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-slate-200 rounded-md shadow-lg mt-1 max-h-56 overflow-auto">
          {suggestions.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-amber-50 text-sm text-slate-700 border-b border-slate-100 last:border-0"
              onMouseDown={() => handleSelect(item)}
            >
              <MapPin className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span>{item.display_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}