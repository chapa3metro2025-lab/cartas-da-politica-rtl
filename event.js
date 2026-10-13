const CORS_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const allowedOpinions=new Set(['Concordo','Discordo','Não sei / depende']);
function reply(body,status=200){return new Response(JSON.stringify(body),{status,headers:CORS_HEADERS});}
export async function onRequestPost({request,env}){
 if(!env.DB)return reply({error:'Banco de dados indisponível'},503);
 const origin=request.headers.get('Origin');
 if(origin&&new URL(origin).origin!==new URL(request.url).origin)return reply({error:'Origem não autorizada'},403);
 const len=Number(request.headers.get('content-length')||0);
 if(len>4096)return reply({error:'Mensagem muito grande'},413);
 let d;try{d=await request.json();}catch{return reply({error:'JSON inválido'},400);}
 if(!d||typeof d!=='object'||typeof d.session!=='string'||! /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(d.session))return reply({error:'Identificador inválido'},400);
 try{
 if(d.event==='start'){
  if(!Number.isInteger(d.count)||d.count<1||d.count>200)return reply({error:'Quantidade inválida'},400);
  await env.DB.prepare('INSERT OR IGNORE INTO partidas(id,quantidade_prevista) VALUES (?,?)').bind(d.session,d.count).run();
  return reply({ok:true});
 }
 if(d.event==='answer'){
  if(typeof d.card!=='string'||! /^[a-z0-9_-]{1,40}$/i.test(d.card)||typeof d.topic!=='string'||d.topic.length>80||!['fact','issue'].includes(d.kind))return reply({error:'Carta inválida'},400);
  if(d.opinion!=null&&!allowedOpinions.has(d.opinion))return reply({error:'Opinião inválida'},400);
  if(d.kind==='fact'&&(typeof d.answer!=='string'||d.answer.length>120||typeof d.correct!=='boolean'))return reply({error:'Resposta inválida'},400);
  const partida=await env.DB.prepare('SELECT id,quantidade_prevista,status FROM partidas WHERE id=?').bind(d.session).first();
  if(!partida||partida.status==='concluida')return reply({error:'Partida inexistente ou concluída'},409);
  const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM respostas WHERE partida_id=?').bind(d.session).first();
  if(n.n>=200)return reply({error:'Limite de respostas'},429);
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO respostas(partida_id,carta_id,tema,tipo,resposta,acertou) VALUES(?,?,?,?,?,?)').bind(d.session,d.card,d.topic,d.kind,JSON.stringify({opinion:d.opinion||null,answer:d.kind==='fact'?d.answer:null}),d.kind==='fact'?(d.correct?1:0):null).run();
  if(inserted.meta?.changes){await env.DB.prepare('UPDATE partidas SET cartas_respondidas=cartas_respondidas+1,acertos=acertos+?,erros=erros+? WHERE id=?').bind(d.kind==='fact'&&d.correct?1:0,d.kind==='fact'&&!d.correct?1:0,d.session).run();}
  return reply({ok:true});
 }
 if(d.event==='finish'){
  const p=await env.DB.prepare('SELECT id FROM partidas WHERE id=?').bind(d.session).first();if(!p)return reply({error:'Partida inexistente'},409);
  await env.DB.prepare("UPDATE partidas SET concluida_em=CURRENT_TIMESTAMP,status='concluida' WHERE id=? AND status!='concluida'").bind(d.session).run();
  return reply({ok:true});
 }
 return reply({error:'Evento desconhecido'},400);
 }catch(e){console.error('Erro interno de registro',e);return reply({error:'Falha ao registrar evento'},500);}
}

export async function onRequestGet({env}) {return new Response(JSON.stringify({ok:!!env.DB,endpoint:'event',method:'POST',database:env.DB?'vinculado':'sem_vinculo'}),{status:env.DB?200:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
