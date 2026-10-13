-- Execute UMA VEZ no Console do D1 existente. Não execute novamente se as colunas já existirem.
ALTER TABLE partidas ADD COLUMN pontuacao_politica INTEGER;
ALTER TABLE partidas ADD COLUMN faixa_politica TEXT;
ALTER TABLE partidas ADD COLUMN opinioes_validas INTEGER;
CREATE INDEX IF NOT EXISTS idx_partidas_faixa ON partidas(faixa_politica);
