-- Distribuição percentual das classificações; partidas inconclusivas separadas.
WITH base AS (
 SELECT COALESCE(faixa_politica,'Inconclusivo / versão anterior') AS faixa, COUNT(*) AS n
 FROM partidas WHERE status='concluida' GROUP BY 1
), validos AS (SELECT SUM(n) AS total FROM base WHERE faixa NOT LIKE 'Inconclusivo%')
SELECT faixa,n AS partidas,ROUND(100.0*n/NULLIF((SELECT total FROM validos),0),1) AS percentual_dos_validos
FROM base ORDER BY CASE faixa WHEN 'Extrema esquerda' THEN 1 WHEN 'Esquerda' THEN 2 WHEN 'Centro-esquerda' THEN 3 WHEN 'Centro' THEN 4 WHEN 'Centro-direita' THEN 5 WHEN 'Direita' THEN 6 WHEN 'Extrema direita' THEN 7 ELSE 8 END;

-- Visão geral
SELECT COUNT(*) AS partidas, SUM(status='concluida') AS concluidas,
 SUM(faixa_politica IS NOT NULL AND faixa_politica!='Inconclusivo') AS classificadas,
 SUM(cartas_respondidas) AS respostas FROM partidas;

-- Por tema
SELECT tema, COUNT(*) AS respostas, SUM(acertou=1) AS acertos_factuais FROM respostas GROUP BY tema ORDER BY respostas DESC;
