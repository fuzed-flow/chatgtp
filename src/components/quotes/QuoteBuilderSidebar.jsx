import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { FileText, Image, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function QuoteBuilderSidebar({ allDocuments, allPhotos, notes }) {
  const [minimized, setMinimized] = useState(false);

  if (minimized) {
    return (
      <div className="w-12 shrink-0 flex items-start pt-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMinimized(false)}
          className="h-8 w-8 p-0"
          title="Expand sidebar"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="xl:w-80 w-full shrink-0">
      <div className="sticky top-6 space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMinimized(true)}
            className="h-8 w-8 p-0"
            title="Minimize sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Documents */}
        <Card className="p-4 bg-white shadow-md border-2 border-amber-400">
          <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-600" />
            Documents ({allDocuments.length})
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {allDocuments.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No documents attached</p>
            ) : (
              allDocuments.map((doc, idx) => (
                <button
                  key={idx}
                  onClick={() => window.open(doc.file_url, '_blank')}
                  className="w-full flex items-center gap-2 p-2 bg-slate-50 hover:bg-amber-50 rounded border border-slate-200 hover:border-amber-400 transition-all text-left group"
                >
                  <FileText className="h-4 w-4 text-slate-600 group-hover:text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-slate-700 group-hover:text-amber-600 truncate block">{doc.file_name}</span>
                    {doc.source !== "quote" && (
                      <span className="text-[10px] text-slate-500">{doc.source}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Photos */}
        <Card className="p-4 bg-white shadow-md border-2 border-amber-400">
          <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Image className="h-4 w-4 text-amber-600" />
            Photos ({allPhotos.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {allPhotos.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No photos added</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allPhotos.map((photo, idx) => (
                  <button
                    key={idx}
                    onClick={() => window.open(photo.url, '_blank')}
                    className="relative group rounded overflow-hidden border-2 border-slate-200 hover:border-amber-400 transition-all"
                  >
                    <img src={photo.url} alt={photo.label} className="w-full h-24 object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white px-1 py-0.5">
                      <div className="text-[10px] truncate">{photo.label}</div>
                      {photo.source !== "quote" && (
                        <div className="text-[9px] text-amber-300">{photo.source}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}