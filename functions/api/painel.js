// Painel administrativo: exige segredo configurado como PANEL_TOKEN em Cloudflare Pages.
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
function constantTimeEqual(a,b){const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
export async function onRequestGet({request,env}){
 if(!env.DB)return send({error:'DIAGNOSTICO_DB: associação com banco de dados não encontrada'},503);
 if(typeof env.PANEL_TOKEN!=='string'||env.PANEL_TOKEN.length<24)return send({error:'DIAGNOSTICO_TOKEN: segredo PANEL_TOKEN ausente ou inválido'},503);
 const auth=request.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer ')||!constantTimeEqual(auth.slice(7),env.PANEL_TOKEN))return send({error:'Acesso não autorizado'},401);
 try{
  const summary=await env.DB.prepare(`SELECT COUNT(*) AS iniciadas,
    COALESCE(SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END),0) AS concluidas,
    COALESCE(SUM(CASE WHEN status='concluida' AND pontuacao_politica IS NOT NULL AND faixa_politica IS NOT NULL AND faixa_politica!='Inconclusivo' THEN 1 ELSE 0 END),0) AS classificadas,
    COALESCE(SUM(CASE WHEN status='concluida' AND faixa_politica='Inconclusivo' THEN 1 ELSE 0 END),0) AS inconclusivas,
    COALESCE(SUM(CASE WHEN status='concluida' AND (faixa_politica IS NULL OR faixa_politica='') THEN 1 ELSE 0 END),0) AS sem_classificacao,
    COALESCE(SUM(cartas_respondidas),0) AS respostas_registradas,
    COALESCE(SUM(acertos),0) AS acertos,
    COALESCE(SUM(erros),0) AS erros
    FROM partidas`).first();
  const rows=await env.DB.prepare(`SELECT faixa_politica AS faixa, COUNT(*) AS quantidade FROM partidas WHERE status='concluida' AND pontuacao_politica IS NOT NULL AND faixa_politica IS NOT NULL AND faixa_politica!='Inconclusivo' GROUP BY faixa_politica`).all();
  const topics=await env.DB.prepare(`SELECT tema,COUNT(*) AS respostas, SUM(CASE WHEN tipo='fact' THEN 1 ELSE 0 END) AS factuais, SUM(CASE WHEN tipo='fact' AND acertou=1 THEN 1 ELSE 0 END) AS acertos FROM respostas GROUP BY tema ORDER BY respostas DESC LIMIT 30`).all();
  const labels=['Extrema esquerda','Esquerda','Centro-esquerda','Centro','Centro-direita','Direita','Extrema direita'];
  const counts=new Map((rows.results||[]).map(r=>[r.faixa,Number(r.quantidade)]));
  const valid=labels.reduce((n,l)=>n+(counts.get(l)||0),0);
  const faixas=labels.map(faixa=>({faixa,quantidade:counts.get(faixa)||0,percentual:valid?Math.round((counts.get(faixa)||0)*1000/valid)/10:0}));
  return send({resumo:summary,faixas,temas:topics.results||[],denominador:'partidas classificadas',gerado_em:new Date().toISOString()});
 }catch(e){console.error('Falha no painel',e);return send({error:'Erro ao consultar estatísticas'},500)}
}
