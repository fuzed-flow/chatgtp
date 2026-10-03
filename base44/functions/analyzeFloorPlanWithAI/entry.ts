import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, sketchImageUrls } = await req.json();

    if (!jobId || !Array.isArray(sketchImageUrls) || sketchImageUrls.length === 0) {
      return Response.json(
        { error: 'Missing jobId or sketchImageUrls' },
        { status: 400 }
      );
    }

    // Update job status to processing
    await base44.entities.Job.update(jobId, {
      floorplan_status: 'processing',
      floorplan_error: '',
      floorplan_generated_at: new Date().toISOString()
    });

    // Call AI to analyze sketches and identify rooms
    const roomAnalysisPrompt = `You are an expert architect and interior designer. Analyze the provided floor plan sketch images and:

1. Identify and label all visible rooms (bedroom, kitchen, bathroom, living room, dining room, hallway, closet, office, etc.)
2. Estimate room dimensions if visible
3. Note any special features (windows, doors, stairs, etc.)
4. Provide a JSON response with the identified rooms

Return a JSON object with this structure:
{
  "rooms": [
    {
      "name": "room name",
      "type": "room type (e.g., bedroom, kitchen)",
      "estimated_dimensions": "W x L (approx)",
      "features": ["feature1", "feature2"],
      "approximate_location": "location in plan"
    }
  ],
  "overall_layout_summary": "brief description of the overall layout"
}`;

    const roomLabelsResponse = await base44.integrations.Core.InvokeLLM({
      prompt: roomAnalysisPrompt,
      file_urls: sketchImageUrls,
      response_json_schema: {
        type: "object",
        properties: {
          rooms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                estimated_dimensions: { type: "string" },
                features: { type: "array", items: { type: "string" } },
                approximate_location: { type: "string" }
              }
            }
          },
          overall_layout_summary: { type: "string" }
        }
      }
    });

    // Call AI for furniture placement suggestions
    const furnitureSuggestionsPrompt = `Based on the floor plan analysis, provide furniture placement and layout optimization suggestions for each room. Consider:

1. Optimal furniture placement for flow and functionality
2. Space efficiency tips
3. Design recommendations for each room type
4. Natural light and window placement considerations
5. Traffic flow optimization

Return a JSON object with this structure:
{
  "suggestions_by_room": [
    {
      "room": "room name",
      "room_type": "room type",
      "furniture_recommendations": [
        {
          "item": "furniture item",
          "placement": "where and how to place it",
          "reasoning": "why this placement works"
        }
      ],
      "optimization_tips": ["tip1", "tip2"],
      "estimated_square_footage": "if identifiable"
    }
  ],
  "overall_design_recommendations": "general recommendations for the entire space"
}`;

    const furnitureSuggestionsResponse = await base44.integrations.Core.InvokeLLM({
      prompt: furnitureSuggestionsPrompt,
      file_urls: sketchImageUrls,
      response_json_schema: {
        type: "object",
        properties: {
          suggestions_by_room: {
            type: "array",
            items: {
              type: "object",
              properties: {
                room: { type: "string" },
                room_type: { type: "string" },
                furniture_recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      item: { type: "string" },
                      placement: { type: "string" },
                      reasoning: { type: "string" }
                    }
                  }
                },
                optimization_tips: { type: "array", items: { type: "string" } },
                estimated_square_footage: { type: "string" }
              }
            }
          },
          overall_design_recommendations: { type: "string" }
        }
      }
    });

    // Update job with AI analysis
    await base44.entities.Job.update(jobId, {
      room_labels: JSON.stringify(roomLabelsResponse),
      furniture_suggestions: JSON.stringify(furnitureSuggestionsResponse),
      floorplan_status: 'complete'
    });

    return Response.json({
      success: true,
      rooms: roomLabelsResponse,
      suggestions: furnitureSuggestionsResponse
    });
  } catch (error) {
    const jobId = await req.json().then(d => d.jobId).catch(() => null);

    if (jobId) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.entities.Job.update(jobId, {
          floorplan_status: 'failed',
          floorplan_error: error.message || 'AI analysis failed. Please try again with clearer images.'
        });
      } catch (updateError) {
        console.error('Failed to update job with error:', updateError);
      }
    }

    console.error('AI Analysis Error:', error);
    return Response.json(
      { error: error.message || 'AI analysis failed' },
      { status: 500 }
    );
  }
});