import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import JSZip from "https://esm.sh/jszip@3.10.1"
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit

const parseEmails = (emailStr: string | undefined | null) => {
  if (!emailStr) return undefined;
  const arr = emailStr.split(',').map(e => e.trim()).filter(e => e);
  return arr.length > 0 ? arr : undefined;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { 
      to, cc, bcc, subject, scope_of_work, attachments, 
      priority, due_date, project_name, address, 
      company_name, company_logo, brand_color,
      signature_name, signature_role, signature_phone,
      sender_email, company_email // ⚡ Added fields to capture the sender's email
    } = await req.json()

    const color = brand_color || '#f59e0b';
    
    const toArray = parseEmails(to);
    const ccArray = parseEmails(cc);
    const bccArray = parseEmails(bcc);

    if (!toArray) throw new Error("At least one 'To' email address is required.");

    // ⚡ BUILD REPLY-TO ARRAY (Sender + Any CCs)
    const rawReplyTo = [];
    if (sender_email) rawReplyTo.push(sender_email);
    if (company_email) rawReplyTo.push(company_email);
    if (ccArray) rawReplyTo.push(...ccArray);
    
    // Remove duplicate emails just in case
    const replyToArray = [...new Set(rawReplyTo.map(e => e.trim()).filter(e => e))];

    let emailAttachments: any[] = [];
    let fallbackLinksHtml = '';

    // ATTACHMENT PROCESSING & ZIP LOGIC
    if (attachments && attachments.length > 0) {
      console.log(`Processing ${attachments.length} attachments...`);

      // 1. Fetch all attachment buffers
      const fetchedFiles = await Promise.all(
        attachments.map(async (att: { path: string; filename: string }, index: number) => {
          try {
            const resp = await fetch(att.path);
            if (!resp.ok) return null;
            const arrayBuffer = await resp.arrayBuffer();
            return {
              filename: att.filename || `attachment_${index + 1}`,
              path: att.path,
              buffer: new Uint8Array(arrayBuffer),
              size: arrayBuffer.byteLength
            };
          } catch (e) {
            console.error(`Failed to download attachment ${att.path}:`, e);
            return null;
          }
        })
      );

      const validFiles = fetchedFiles.filter((f): f is NonNullable<typeof f> => f !== null);
      const totalSize = validFiles.reduce((acc, f) => acc + f.size, 0);

      console.log(`Total attachments uncompressed size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

      // 2. Check if total size exceeds 25 MB
      if (totalSize > MAX_ATTACHMENT_SIZE_BYTES) {
        console.log("Attachments exceed 25MB. Creating ZIP archive...");
        
        const zip = new JSZip();
        validFiles.forEach((file, idx) => {
          const safeName = file.filename || `file_${idx + 1}`;
          zip.file(safeName, file.buffer);
        });

        const zipBuffer = await zip.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });

        console.log(`Zipped size: ${(zipBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`);

        if (zipBuffer.byteLength <= MAX_ATTACHMENT_SIZE_BYTES) {
          // ZIP fits under 25MB -> Attach single ZIP file
          const safeProjectPrefix = project_name ? project_name.replace(/[^a-zA-Z0-9]/g, '_') : 'Quote_Request';
          emailAttachments = [{
            filename: `${safeProjectPrefix}_Attachments.zip`,
            content: encodeBase64(zipBuffer)
          }];
        } else {
          // ZIP is STILL over 25MB -> Render fallback download links in email
          console.log("ZIP archive still exceeds 25MB. Generating fallback links...");
          fallbackLinksHtml = `
            <div style="margin-top: 24px; padding: 16px; background-color: #fff3cd; border: 1px solid #ffeba2; border-radius: 6px;">
              <strong style="color: #856404; font-size: 14px;">Note:</strong>
              <p style="color: #856404; font-size: 13px; margin: 4px 0 10px 0;">The total size of the attached files exceeded email limits (25MB). You can access and download all files directly using the links below:</p>
              <ul style="margin: 0; padding-left: 20px;">
                ${validFiles.map(f => `
                  <li style="margin-bottom: 6px;">
                    <a href="${f.path}" style="color: #d97706; font-weight: bold; font-size: 13px; text-decoration: none;">Download ${f.filename} &rarr;</a>
                  </li>
                `).join('')}
              </ul>
            </div>
          `;
        }
      } else {
        // Under 25MB -> Attach files individually
        emailAttachments = validFiles.map(f => ({
          filename: f.filename,
          content: encodeBase64(f.buffer)
        }));
      }
    }

    // 3. Send via Resend
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'FuzedFlow <alerts@mail.fuzedflow.com>', 
        reply_to: replyToArray.length > 0 ? replyToArray : undefined, // ⚡ Added Dynamic Reply-To 
        to: toArray,
        cc: ccArray,
        bcc: bccArray,
        subject: subject,
        attachments: emailAttachments.length > 0 ? emailAttachments : undefined, 
        html: `
          <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            
            <!-- Header -->
            <div style="background-color: #0f172a; padding: 24px; border-bottom: 4px solid ${color};">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  ${company_logo ? `<td style="width: 55px; padding-right: 15px;"><img src="${company_logo}" alt="${company_name || 'Logo'}" style="height: 40px; max-width: 55px; border-radius: 4px; display: block;" /></td>` : ''}
                  <td style="vertical-align: middle;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">Quote Request</h2>
                    <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">From: ${company_name || 'Our Company'}</p>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Content -->
            <div style="padding: 24px;">
              <p style="color: #334155; font-size: 16px; margin-top: 0;">Please review the following scope of work and provide pricing, timelines, or confirmation of availability.</p>

              <!-- Information Grid -->
              <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: #f8fafc; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; width: 50%;">
                    <strong style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Priority</strong><br/>
                    <span style="color: #0f172a; font-size: 14px; font-weight: bold;">${priority || 'Medium'}</span>
                  </td>
                  <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; width: 50%;">
                    <strong style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Requested Due Date</strong><br/>
                    <span style="color: #0f172a; font-size: 14px; font-weight: bold;">${due_date || 'TBD'}</span>
                  </td>
                </tr>
                ${project_name || address ? `
                <tr>
                  <td colspan="2" style="padding: 12px;">
                    ${project_name ? `<strong style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Related Project / Client</strong><br/><span style="color: #0f172a; font-size: 14px; font-weight: bold;">${project_name}</span><br/><br/>` : ''}
                    ${address ? `<strong style="color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Site Address</strong><br/><span style="color: #0f172a; font-size: 14px; font-weight: bold;">${address}</span>` : ''}
                  </td>
                </tr>
                ` : ''}
              </table>

              <!-- Scope of Work -->
              <h3 style="color: #0f172a; margin-top: 28px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px; font-size: 16px;">Scope of Work Details</h3>
              <div style="background-color: #f8fafc; border-left: 4px solid ${color}; padding: 16px; border-radius: 0 4px 4px 0;">
                <p style="white-space: pre-wrap; margin: 0; color: #334155; font-size: 14px; line-height: 1.6;">${scope_of_work}</p>
              </div>

              <!-- Fallback links if total files > 25MB after zip -->
              ${fallbackLinksHtml}

              <!-- Signature -->
              <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0; color: #0f172a; font-weight: bold; font-size: 14px;">${signature_name || 'The Team'}</p>
                ${signature_role ? `<p style="margin: 2px 0 0 0; color: #64748b; font-size: 13px;">${signature_role}</p>` : ''}
                ${company_name ? `<p style="margin: 2px 0 0 0; color: #64748b; font-size: 13px;">${company_name}</p>` : ''}
                ${signature_phone ? `<p style="margin: 2px 0 0 0; color: #64748b; font-size: 13px;">${signature_phone}</p>` : ''}
              </div>

            </div>
          </div>
        `,
      }),
    })

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: res.ok ? 200 : 400,
    })
  } catch (error: any) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 400,
    })
  }
})