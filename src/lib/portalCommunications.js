export function portalCommunicationAccess(params) {
  for (const [key, kind] of [['portal_token','portal'],['quote_token','quote'],['invoice_token','invoice'],['co_token','change_order']]) {
    const token=params.get(key);
    if(token) return {token,kind};
  }
  return null;
}

export async function addPortalCommunicationAccess(db, url, clientId) {
  const {data,error}=await db.rpc('issue_client_portal_communication_token',{p_client:clientId});
  if(error) throw new Error('A private client portal link could not be created. Please try again.');
  if(!data) return url;
  const result=new URL(url);result.searchParams.set('portal_token',data);return result.toString();
}

export function portalMessagingEnabled(companySettings, clientFeatures) {
  let features=clientFeatures||{};
  if(typeof features==='string'){try{features=JSON.parse(features);}catch{return false;}}
  return companySettings?.client_portal?.show_communications===true && features?.direct_messaging!==false;
}

export function mergePortalMessages(current, incoming) {
  const rows=new Map(current.map(row=>[row.id,row]));
  incoming.forEach(row=>rows.set(row.id,row));
  return [...rows.values()].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
}
import { communicationPhone } from './clientCommunications.js';

export function isSavedPortalRecipient(client, recipient, mode) {
  if (mode === 'email') return Boolean(client?.email?.trim()) && client.email.trim().toLowerCase() === String(recipient || '').trim().toLowerCase();
  const phone = communicationPhone(client?.phone);
  return Boolean(phone) && phone === communicationPhone(recipient);
}

