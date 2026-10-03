import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Download, ExternalLink, Upload, Loader2, X, Lightbulb } from "lucide-react";

const statusConfig = {
  idle: { label: "Ready", color: "bg-slate-100 text-slate-800" },
  processing: { label: "Processing...", color: "bg-blue-100 text-blue-800" },
  complete: { label: "Complete", color: "bg-green-100 text-green-800" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800" }
};

export default function FloorPlanGenerator({ job }) {
  const [sketchFiles, setSketchFiles] = useState([]);
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!job.sketch_images || job.sketch_images.length === 0) {
        throw new Error("Please upload at least one sketch image first.");
      }

      return await base44.functions.invoke("analyzeFloorPlanWithAI", {
        jobId: job.id,
        sketchImageUrls: job.sketch_images
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
    }
  });

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const uploadedUrls = [];
      
      for (const file of files) {
        const response = await base44.integrations.Core.UploadFile({ file });
        const fileUrl = response.data?.file_url || response.file_url;
        uploadedUrls.push(fileUrl);
        setSketchFiles(prev => [...prev, { name: file.name, url: fileUrl }]);
      }

      const allImages = [...(job.sketch_images || []), ...uploadedUrls];
      await base44.entities.Job.update(job.id, { sketch_images: allImages });
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
    } catch (error) {
      console.error("Upload failed:", error);
    }
  };

  const removeImage = async (index) => {
    const updatedImages = job.sketch_images.filter((_, i) => i !== index);
    await base44.entities.Job.update(job.id, { sketch_images: updatedImages });
    queryClient.invalidateQueries({ queryKey: ["job", job.id] });
  };

  const handleDownload = () => {
    if (job.floorplan_png_url) {
      const a = document.createElement("a");
      a.href = job.floorplan_png_url;
      a.download = `floorplan-${job.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const isProcessing = job.floorplan_status === "processing";
  const isComplete = job.floorplan_status === "complete";
  const isFailed = job.floorplan_status === "failed";

  let roomLabels = null;
  let furnitureSuggestions = null;
  
  try {
    if (job.room_labels) roomLabels = JSON.parse(job.room_labels);
    if (job.furniture_suggestions) furnitureSuggestions = JSON.parse(job.furniture_suggestions);
  } catch (e) {
    console.error("Failed to parse AI data:", e);
  }

  return (
    <div className="space-y-4">
      {/* Main Generator Card */}
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">AI Floor Plan Generator</CardTitle>
            <Badge className={statusConfig[job.floorplan_status || "idle"].color}>
              {statusConfig[job.floorplan_status || "idle"].label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Sketch Images ({job.sketch_images?.length || 0} uploaded)</label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                disabled={isProcessing}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 text-center hover:bg-amber-100/50 transition-colors">
                <Upload className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-700">Click to upload sketches</p>
                <p className="text-xs text-slate-600 mt-1">or drag and drop multiple images</p>
                <p className="text-xs text-slate-500 mt-2">Dark lines, minimal shadows work best</p>
              </div>
            </div>

            {/* Uploaded Images Preview */}
            {job.sketch_images && job.sketch_images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                {job.sketch_images.map((url, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={url}
                      alt={`Sketch ${idx + 1}`}
                      className="w-full h-24 object-cover rounded-lg border border-slate-200"
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Analyze Button */}
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={isProcessing || !job.sketch_images?.length}
            className="w-full gap-2"
            size="lg"
          >
            {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
            {isProcessing ? "Analyzing with AI..." : "Generate Plan & Analyze (AI)"}
          </Button>

          {/* Error Message */}
          {isFailed && job.floorplan_error && (
            <div className="flex gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Analysis Failed</p>
                <p className="text-xs text-red-800 mt-1">{job.floorplan_error}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Room Labels Card */}
      {isComplete && roomLabels && (
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-blue-600" />
              AI-Identified Rooms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 italic">{roomLabels.overall_layout_summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {roomLabels.rooms?.map((room, idx) => (
                <div key={idx} className="p-3 bg-white rounded-lg border border-blue-100">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-slate-900">{room.name}</p>
                      <p className="text-xs text-slate-500">{room.type}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{room.estimated_dimensions}</Badge>
                  </div>
                  {room.features && room.features.length > 0 && (
                    <p className="text-xs text-slate-600">Features: {room.features.join(", ")}</p>
                  )}
                  {room.approximate_location && (
                    <p className="text-xs text-slate-500 mt-1">Location: {room.approximate_location}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Furniture Suggestions Card */}
      {isComplete && furnitureSuggestions && (
        <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-green-600" />
              AI Furniture & Layout Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 italic">{furnitureSuggestions.overall_design_recommendations}</p>
            <div className="space-y-4">
              {furnitureSuggestions.suggestions_by_room?.map((roomSugg, idx) => (
                <div key={idx} className="p-4 bg-white rounded-lg border border-green-100">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-slate-900">{roomSugg.room}</h4>
                    {roomSugg.estimated_square_footage && (
                      <Badge variant="outline" className="text-xs">{roomSugg.estimated_square_footage}</Badge>
                    )}
                  </div>

                  {/* Furniture Recommendations */}
                  {roomSugg.furniture_recommendations && roomSugg.furniture_recommendations.length > 0 && (
                    <div className="mb-3 space-y-2">
                      <p className="text-xs font-medium text-slate-700">Furniture Placement:</p>
                      <div className="space-y-2">
                        {roomSugg.furniture_recommendations.map((item, itemIdx) => (
                          <div key={itemIdx} className="p-2 bg-green-50 rounded border border-green-100 text-xs">
                            <p className="font-medium text-slate-900">{item.item}</p>
                            <p className="text-slate-700">{item.placement}</p>
                            <p className="text-slate-500 italic mt-1">→ {item.reasoning}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Optimization Tips */}
                  {roomSugg.optimization_tips && roomSugg.optimization_tips.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-700 mb-2">Optimization Tips:</p>
                      <ul className="text-xs text-slate-600 space-y-1">
                        {roomSugg.optimization_tips.map((tip, tipIdx) => (
                          <li key={tipIdx} className="flex gap-2">
                            <span className="text-green-600 font-bold">•</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Floor Plan Preview */}
      {isComplete && job.floorplan_png_url && (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg">Generated Floor Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
              <img
                src={job.floorplan_png_url}
                alt="Generated floor plan"
                className="w-full h-auto max-h-96 object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={() => window.open(job.floorplan_png_url, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
                Open PNG
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
            {job.floorplan_generated_at && (
              <p className="text-xs text-slate-600">
                Generated: {new Date(job.floorplan_generated_at).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}