import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function ErrorState({ title = "Something went wrong", message, onRetry }) {
  return (
    <Card className="p-6 border-red-200 bg-red-50/50">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="font-semibold text-red-900">{title}</h3>
          {message && <p className="text-sm text-red-700 mt-1">{message}</p>}
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="mt-3 text-red-600 hover:bg-red-100">
              Try Again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}