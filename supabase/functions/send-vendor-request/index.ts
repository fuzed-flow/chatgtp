import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import JSZip from "https://esm.sh/jszip@3.10.1"
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit

const parseEmails = (emailStr: string | undefined | null) => {
  if (!emailStr) return undefined;
  const arr = emailStr.split(',').map(e => e.trim()).filter(e => e);
  return arr.length > 0 ? arr : undefined;
};
const validCompanyEmail = (value: unknown) => typeof value === 'string' && value.trim().length <= 254
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && !/[\r\n]/.test(value);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  let deliveryContext: { companyId: string; requestId: string; actor: string; sendKey: string } | null = null;
  let serviceDb: any = null;
  let providerAccepted = false;
  let copyOnly = false;
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey || !RESEND_API_KEY) throw new Error('Email service unavailable');
    const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await db.auth.getUser(authorization.slice(7).trim());
    if (authError || !authData?.user) throw new Error('Authentication required');
    const { data: profile, error: profileError } = await db.from('profiles').select('company_id,role,is_active,permissions').eq('id', authData.user.id).single();
    if (profileError || !profile?.company_id || profile.is_active === false || !['owner','admin','manager','office'].includes(profile.role)) throw new Error('Company management access required');
    if (!['owner','admin'].includes(profile.role) && Array.isArray(profile.permissions) && profile.permissions.length && !profile.permissions.includes('vendors')) throw new Error('Vendor access required');
    const { 
      to, cc, bcc, subject, scope_of_work, attachments, 
      priority, due_date, project_name, address, 
      company_name, company_logo, brand_color,
      signature_name, signature_role, signature_phone,
      sender_email, company_email,
      request_id, vendor_request_id, send_copy_to_company, copy_only,
    } = await req.json()
    copyOnly = copy_only === true;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (request_id != null && (typeof request_id !== 'string' || !uuid.test(request_id))) throw new Error('Invalid send request');
    let requestRecord: any = null;
    if (vendor_request_id != null) {
      if (typeof vendor_request_id !== 'string' || !uuid.test(vendor_request_id)) throw new Error('Invalid vendor request');
      const { data, error } = await db.from('vendor_requests').select('id,company_id,project_id,attachments,status,title').eq('id', vendor_request_id).eq('company_id', profile.company_id).single();
      if (error || !data) throw new Error('Vendor request is unavailable');
      requestRecord = data;
      deliveryContext = { companyId: profile.company_id, requestId: vendor_request_id, actor: authData.user.id, sendKey: request_id || vendor_request_id };
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!serviceKey) throw new Error('Email delivery tracking unavailable');
      serviceDb = createClient(supabaseUrl, serviceKey);
    }
    if (copy_only === true && (!send_copy_to_company || !requestRecord || requestRecord.status !== 'Sent' || !request_id)) {
      throw new Error('A sent request is required before retrying the company copy');
    }
    let copyRecipient: string | null = null;
    let copyCompanyName = '';
    if (send_copy_to_company === true) {
      if (!requestRecord || !request_id) throw new Error('A saved vendor request is required for a company copy');
      const { data: company, error } = await db.from('companies').select('name,settings').eq('id', profile.company_id).single();
      if (error || !company || !validCompanyEmail(company.settings?.email)) throw new Error('Add a valid company email in Settings to receive a copy');
      copyRecipient = company.settings.email.trim();
      copyCompanyName = String(company.name || '').replace(/[\r\n]+/g, ' ').trim();
      if (!copyCompanyName) throw new Error('Save your company name before requesting a copy');
      if (!String(requestRecord.title || '').trim()) throw new Error('Save the request title before requesting a copy');
    }
    const allowedAttachment = (path: string) => {
      try {
        const url = new URL(path);
        return url.protocol === 'https:' && url.origin === new URL(supabaseUrl).origin
          && url.pathname.startsWith('/storage/v1/object/public/')
          && (!requestRecord || (Array.isArray(requestRecord.attachments) && requestRecord.attachments.includes(path)));
      } catch { return false; }
    };
    if (attachments != null && (!Array.isArray(attachments) || attachments.length > 30 || attachments.some((a: any) => !a || typeof a.path !== 'string' || !allowedAttachment(a.path)))) throw new Error('Attachments must be files from this request in company storage');

    const color = brand_color || '#f59e0b';
    
    const toArray = parseEmails(to);
    const ccArray = parseEmails(cc);
    const bccArray = parseEmails(bcc);

    if (!toArray) throw new Error("At least one 'To' email address is required.");
    for (const address of [...toArray, ...(ccArray || []), ...(bccArray || [])]) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254 || /[\r\n]/.test(address)) throw new Error('Enter valid recipient email addresses');
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 998 || /[\r\n]/.test(subject) || typeof scope_of_work !== 'string') throw new Error('Email subject and scope are required');

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
            const resp = await fetch(att.path, { redirect: 'error' });
            if (!resp.ok) throw new Error('Attachment unavailable');
            const declared = Number(resp.headers.get('content-length') || 0);
            if (declared > 30 * 1024 * 1024) throw new Error('Attachment is too large');
            const arrayBuffer = await resp.arrayBuffer();
            if (arrayBuffer.byteLength > 30 * 1024 * 1024) throw new Error('Attachment is too large');
            return {
              filename: att.filename || `attachment_${index + 1}`,
              path: att.path,
              buffer: new Uint8Array(arrayBuffer),
              size: arrayBuffer.byteLength
            };
          } catch (e) {
            console.error('Vendor request attachment could not be loaded');
            throw new Error('One or more attachments could not be loaded. Please remove or replace them before sending.');
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
    const emailPayload = {
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
    };
    const sendProvider = async (payload: typeof emailPayload, suffix: string) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}`,
          ...(request_id ? { 'Idempotency-Key': `fuzedflow/${profile.company_id}/${request_id}/${suffix}` } : {}) },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !uuid.test(data?.id || '')) throw new Error('Email provider could not confirm this request');
      return data;
    };
    const data = copy_only === true ? null : await sendProvider(emailPayload, 'vendor-request');
    if (data) providerAccepted = true;
    if (data && serviceDb && deliveryContext) {
      const { error: trackingError } = await serviceDb.rpc('register_outbound_delivery', {
        p_provider: 'resend', p_provider_id: data.id, p_company: deliveryContext.companyId,
        p_related: 'Trade', p_id: deliveryContext.requestId, p_actor: deliveryContext.actor,
        p_kind: 'document', p_copy: false, p_recipient: toArray[0], p_sender: 'alerts@mail.fuzedflow.com',
      });
      if (trackingError) console.error('Vendor delivery accepted; delivery tracking could not be saved');
    }
    let copyStatus = 'not_requested';
    if (copyRecipient) {
      try {
        const copy = await sendProvider({ ...emailPayload, to: [copyRecipient], cc: undefined, bcc: undefined,
          subject: `[COPY] Quote Request from ${copyCompanyName} - ${String(requestRecord.title).replace(/[\r\n]+/g, ' ').trim()}` }, 'vendor-request-copy');
        copyStatus = 'sent';
        if (serviceDb && deliveryContext) {
          const { error } = await serviceDb.rpc('register_outbound_delivery', {
            p_provider: 'resend', p_provider_id: copy.id, p_company: deliveryContext.companyId,
            p_related: 'Trade', p_id: deliveryContext.requestId, p_actor: deliveryContext.actor,
            p_kind: 'document', p_copy: true, p_recipient: copyRecipient, p_sender: 'alerts@mail.fuzedflow.com',
          });
          if (error) console.error('Vendor company copy accepted; delivery tracking could not be saved');
        }
      } catch {
        copyStatus = 'failed';
        console.error('Vendor company copy could not be confirmed');
      }
    }
    return new Response(JSON.stringify({ success: true, id: data?.id, copy_status: copyStatus }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 200,
    })
  } catch (error: any) {
    if (serviceDb && deliveryContext && !providerAccepted && !copyOnly) {
      try {
        await serviceDb.rpc('record_sales_event', { p_id: deliveryContext.requestId, p_company: deliveryContext.companyId, p_related: 'Trade', p_event: 'vendor_request_delivery_failed', p_actor: deliveryContext.actor, p_reference: deliveryContext.sendKey, p_message: 'Trade request email could not be sent. Review the recipient and attachments, then retry.' });
      } catch { console.error('Vendor request delivery failure could not be recorded'); }
    }
    console.error('Vendor request email could not be sent');
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 400,
    })
  }
})
