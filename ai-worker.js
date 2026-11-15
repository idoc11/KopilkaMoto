export default {
 async fetch(request, env) {
  const origin=request.headers.get("Origin")||"";
  const allowed=env.ALLOWED_ORIGIN||"*";
  const headers={"Access-Control-Allow-Origin":allowed==="*"?"*":(origin===allowed?allowed:"null"),"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
  if(request.method==="OPTIONS")return new Response(null,{headers});
  if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers});
  if(allowed!=="*"&&origin!==allowed)return Response.json({error:"Origin not allowed"},{status:403,headers});
  if(!env.OPENAI_API_KEY)return Response.json({error:"OPENAI_API_KEY is not configured"},{status:503,headers});
  try{
   const body=await request.json(),ctx=JSON.stringify(body.context||{}).slice(0,12000);
   const msgs=[{role:"system",content:"Ты финансовый помощник KopilkaMoto. Отвечай по-русски, в рублях. Анализируй только предоставленные данные, не выдумывай операции и не обещай доходность. Контекст: "+ctx},...(Array.isArray(body.messages)?body.messages.slice(-12):[]).filter(m=>["user","assistant"].includes(m.role)&&typeof m.content==="string").map(m=>({role:m.role,content:m.content.slice(0,3000)}))];
   const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:env.OPENAI_MODEL||"gpt-4o-mini",messages:msgs,max_tokens:900,temperature:.5})});
   const data=await r.json();if(!r.ok)return Response.json({error:data.error?.message||"OpenAI error"},{status:r.status,headers});
   return Response.json({reply:data.choices?.[0]?.message?.content||"Нет ответа"},{headers});
  }catch(e){return Response.json({error:"Invalid request"},{status:400,headers})}
 }
};