import { META } from './scoring.js';
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
  // Uma resposta por carta e participante: primeira resposta em partida concluída.
  // Identificadores antigos sem participante permanecem como partidas separadas.
  const dedupCTE=`WITH ranked AS (
    SELECT COALESCE(pp.participante_id, 'legado:' || p.id) AS pessoa,
      r.carta_id,r.tema,r.tipo,r.resposta,r.acertou,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(pp.participante_id, 'legado:' || p.id),r.carta_id
        ORDER BY p.concluida_em ASC,p.id ASC,r.rowid ASC) AS rn
    FROM respostas r JOIN partidas p ON p.id=r.partida_id
    LEFT JOIN participantes_partidas pp ON pp.partida_id=p.id
    WHERE p.status='concluida'
  ), unicas AS (SELECT * FROM ranked WHERE rn=1)`;
  const uniques=await env.DB.prepare(`${dedupCTE} SELECT
    COUNT(DISTINCT pessoa) AS participantes_estimados,COUNT(*) AS respostas_unicas,
    COALESCE(SUM(CASE WHEN tipo='fact' AND acertou=1 THEN 1 ELSE 0 END),0) AS acertos_unicos,
    COALESCE(SUM(CASE WHEN tipo='fact' AND acertou=0 THEN 1 ELSE 0 END),0) AS erros_unicos
    FROM unicas`).first();
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
  const uniqueTopics=await env.DB.prepare(`${dedupCTE} SELECT tema,COUNT(*) AS respostas,
    SUM(CASE WHEN tipo='fact' THEN 1 ELSE 0 END) AS factuais,
    SUM(CASE WHEN tipo='fact' AND acertou=1 THEN 1 ELSE 0 END) AS acertos
    FROM unicas GROUP BY tema ORDER BY respostas DESC LIMIT 30`).all();
  // Recalcula o espectro político com TODAS as opiniões distintas de cada participante.
  // Não usa a classificação da primeira partida nem duplica uma carta repetida.
  const issueRows=await env.DB.prepare(`${dedupCTE} SELECT pessoa,carta_id,resposta
    FROM unicas WHERE tipo='issue' ORDER BY pessoa`).all();
  const perPerson=new Map();
  for(const r of issueRows.results||[]){
    const m=META[r.carta_id];if(!m||![-1,1].includes(m.polarity))continue;
    if(!['economia','trabalho','costumes','direitos','instituicoes'].includes(m.dimension))continue;
    let opinion;try{opinion=JSON.parse(r.resposta).opinion}catch{continue}
    if(opinion!=='Concordo'&&opinion!=='Discordo')continue;
    if(!perPerson.has(r.pessoa))perPerson.set(r.pessoa,{economia:[],trabalho:[],costumes:[],direitos:[],instituicoes:[]});
    perPerson.get(r.pessoa)[m.dimension].push(50-(opinion==='Concordo'?1:-1)*m.polarity*35);
  }
  const labels=['Extrema esquerda','Esquerda','Centro-esquerda','Centro','Centro-direita','Direita','Extrema direita'];
  const counts=new Map(labels.map(x=>[x,0]));
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  for(const dims of perPerson.values()){
    const covered=Object.values(dims).filter(a=>a.length>=2);
    const n=Object.values(dims).reduce((sum,a)=>sum+a.length,0);
    if(n<10||covered.length<5)continue;
    const score=Math.round(mean(covered.map(mean)));
    const label=labels[Math.min(6,Math.floor(score*7/101))];
    counts.set(label,counts.get(label)+1);
  }
  const valid=[...counts.values()].reduce((a,b)=>a+b,0);
  const faixas=labels.map(faixa=>({faixa,quantidade:counts.get(faixa)||0,percentual:valid?Math.round((counts.get(faixa)||0)*1000/valid)/10:0}));
  return send({resumo:{...summary,...uniques},faixas,temas:uniqueTopics.results||[],denominador:'respostas distintas por carta e navegador, acumuladas entre partidas concluídas; histórico anterior sem identificador permanece separado',gerado_em:new Date().toISOString()});
 }catch(e){console.error('Falha no painel',e);return send({error:'Erro ao consultar estatísticas'},500)}
}
