import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, sketchImageUrl } = await req.json();

    if (!jobId || !sketchImageUrl) {
      return Response.json(
        { error: 'Missing jobId or sketchImageUrl' },
        { status: 400 }
      );
    }

    // Update job status to processing
    await base44.entities.Job.update(jobId, {
      floorplan_status: 'processing',
      floorplan_error: '',
      floorplan_generated_at: new Date().toISOString()
    });

    // Call external webhook
    const webhookUrl = 'https://YOUR_WEBHOOK_DOMAIN/generate-floorplan';
    const apiKey = Deno.env.get('FLOORPLAN_API_KEY');

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      },
      body: JSON.stringify({
        image_url: sketchImageUrl,
        output: 'png',
        settings: {
          threshold: 'auto',
          denoise: 2,
          line_thickness: 2,
          remove_text: true,
          margin_crop: true
        },
        job_id: jobId
      })
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      throw new Error(`Webhook error: ${webhookResponse.status} - ${errorText}`);
    }

    const result = await webhookResponse.json();

    if (!result.png_url) {
      throw new Error('No png_url in webhook response');
    }

    // Update job with generated floor plan
    const job = await base44.entities.Job.get(jobId);
    await base44.entities.Job.update(jobId, {
      floorplan_png_url: result.png_url,
      floorplan_status: 'complete',
      floorplan_version: (job.floorplan_version || 1) + 1
    });

    return Response.json({
      success: true,
      pngUrl: result.png_url
    });
  } catch (error) {
    const jobId = await req.json().then(d => d.jobId).catch(() => null);

    if (jobId) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.entities.Job.update(jobId, {
          floorplan_status: 'failed',
          floorplan_error: error.message || 'Floor plan generation failed. Please try a clearer photo.'
        });
      } catch (updateError) {
        console.error('Failed to update job with error:', updateError);
      }
    }

    return Response.json(
      { error: error.message || 'Floor plan generation failed' },
      { status: 500 }
    );
  }
});