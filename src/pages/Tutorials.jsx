import React from "react";
import { PlayCircle, Video } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function Tutorials() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-black text-slate-900">
          <PlayCircle className="h-8 w-8 text-blue-500" /> Video Tutorials
        </h1>
        <p className="mt-2 font-medium text-slate-500">
          Learn how to master Fuzed Flow with these quick guides.
        </p>
      </div>

      <Card className="flex min-h-[400px] flex-col items-center justify-center space-y-4 border-dashed border-slate-200 p-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
          <Video className="h-10 w-10 text-slate-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">
            Video Tutorials Coming Soon!
          </h3>
          <p className="mx-auto mt-2 max-w-md font-medium text-slate-500">
            We are currently in the studio recording step-by-step video guides to help you get the absolute most out of your account. Check back soon!
          </p>
        </div>
      </Card>
    </div>
  );
}