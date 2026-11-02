export const fixture=window.portalFixture;
export const supabase={
  from(table){const write={table};const chain={update(value){write.value=value;return chain;},eq(key,value){write[key]=value;return chain;},then(resolve){fixture.writes.push(write);resolve({error:fixture.saveError?new Error('Save failed'):null});}};return chain;},
  async rpc(name,args){fixture.rpcs.push({name,args:{...args}});if(fixture.rpcError)return {error:{message:'Private link unavailable'}};
    if(name==='get_client_portal_communications')return {data:{enabled:fixture.enabled,company_name:'Sample Company',email_available:true,sms_available:fixture.smsAvailable!==false,has_more:args.p_before?false:!!fixture.hasMore,messages:args.p_before?fixture.older:fixture.messages},error:null};
    throw new Error('Unexpected RPC '+name);
  },
  functions:{async invoke(name,{body}){fixture.sends.push({name,body:{...body}});if(fixture.nextSend)return fixture.nextSend();
    fixture.messages.unshift({id:'new-message',type:body.channel,subject:body.subject,message:body.message,direction:'Inbound',status:'Sent',created_at:'2026-11-02T18:00:00Z'});
    return{data:{success:true,message_id:'new-message'},error:null};}},
};
