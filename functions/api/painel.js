// Painel administrativo: exige segredo configurado como PANEL_TOKEN em Cloudflare Pages.
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
function constantTimeEqual(a,b){const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
export async function onRequestGet({request,env}){
 if(!env.DB)return send({error:'DIAGNOSTICO_DB: associação com banco de dados não encontrada'},503);
 if(typeof env.PANEL_TOKEN!=='string'||env.PANEL_TOKEN.length<24)return send({error:'DIAGNOSTICO_TOKEN',recebido:typeof env.PANEL_TOKEN,tamanho:typeof env.PANEL_TOKEN==='string'?env.PANEL_TOKEN.length:0},503);
 const auth=request.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer ')||!constantTimeEqual(auth.slice(7),env.PANEL_TOKEN))return send({error:'Acesso não autorizado'},401);
 try{
  // Partidas anteriores à atualização permanecem no histórico e são contabilizadas
  // separadamente como participantes não identificáveis (estimativa conservadora).
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS participantes_partidas (partida_id TEXT PRIMARY KEY, participante_id TEXT NOT NULL, criada_em TEXT DEFAULT CURRENT_TIMESTAMP)').run();
  const uniqueBase=`FROM partidas p LEFT JOIN participantes_partidas pp ON pp.partida_id=p.id
    WHERE p.status='concluida' AND (
      pp.participante_id IS NULL OR p.id=(SELECT p2.id FROM partidas p2
        JOIN participantes_partidas pp2 ON pp2.partida_id=p2.id
        WHERE pp2.participante_id=pp.participante_id AND p2.status='concluida'
        ORDER BY p2.concluida_em ASC,p2.id ASC LIMIT 1))`;
  const uniques=await env.DB.prepare(`SELECT COUNT(*) AS participantes_estimados,
    COALESCE(SUM(p.cartas_respondidas),0) AS respostas_unicas,
    COALESCE(SUM(p.acertos),0) AS acertos_unicos,
    COALESCE(SUM(p.erros),0) AS erros_unicos ${uniqueBase}`).first();
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
  const uniqueRows=await env.DB.prepare(`SELECT p.faixa_politica AS faixa,COUNT(*) AS quantidade ${uniqueBase}
    AND p.pontuacao_politica IS NOT NULL AND p.faixa_politica IS NOT NULL
    AND p.faixa_politica!='Inconclusivo' GROUP BY p.faixa_politica`).all();
  const uniqueTopics=await env.DB.prepare(`SELECT r.tema,COUNT(*) AS respostas,
    SUM(CASE WHEN r.tipo='fact' THEN 1 ELSE 0 END) AS factuais,
    SUM(CASE WHEN r.tipo='fact' AND r.acertou=1 THEN 1 ELSE 0 END) AS acertos
    FROM respostas r JOIN partidas p ON p.id=r.partida_id
    LEFT JOIN participantes_partidas pp ON pp.partida_id=p.id
    WHERE p.status='concluida' AND (pp.participante_id IS NULL OR p.id=(SELECT p2.id FROM partidas p2
      JOIN participantes_partidas pp2 ON pp2.partida_id=p2.id WHERE pp2.participante_id=pp.participante_id
      AND p2.status='concluida' ORDER BY p2.concluida_em ASC,p2.id ASC LIMIT 1))
    GROUP BY r.tema ORDER BY respostas DESC LIMIT 30`).all();
  const labels=['Extrema esquerda' ,'Esquerda','Centro-esquerda','Centro','Centro-direita','Direita','Extrema direita'];
  const counts=new Map((uniqueRows.results||[]).map(r=>[r.faixa,Number(r.quantidade)]));
  const valid=labels.reduce((n,l)=>n+(counts.get(l)||0),0);
  const faixas=labels.map(faixa=>({faixa,quantidade:counts.get(faixa)||0,percentual:valid?Math.round((counts.get(faixa)||0)*1000/valid)/10:0}));
  return send({resumo:{...summary,...uniques},faixas,temas:uniqueTopics.results||[],denominador:'primeira partida concluída por navegador (estimativa); histórico anterior não deduplicável',gerado_em:new Date().toISOString()});
 }catch(e){console.error('Falha no painel',e);return send({error:'Erro ao consultar estatísticas'},500)}
}
