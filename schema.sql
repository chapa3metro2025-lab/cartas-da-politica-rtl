-- Executar uma única vez no Cloudflare D1 (Console > Execute SQL).
CREATE TABLE IF NOT EXISTS partidas (
 id TEXT PRIMARY KEY,
 quantidade_prevista INTEGER NOT NULL,
 iniciada_em TEXT DEFAULT CURRENT_TIMESTAMP,
 concluida_em TEXT,
 status TEXT NOT NULL DEFAULT 'iniciada',
 cartas_respondidas INTEGER NOT NULL DEFAULT 0,
 acertos INTEGER NOT NULL DEFAULT 0,
 erros INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS respostas (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 partida_id TEXT NOT NULL,
 carta_id TEXT NOT NULL,
 tema TEXT NOT NULL,
 tipo TEXT NOT NULL,
 resposta TEXT NOT NULL,
 acertou INTEGER,
 criada_em TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(partida_id,carta_id),
 FOREIGN KEY(partida_id) REFERENCES partidas(id)
);
CREATE INDEX IF NOT EXISTS idx_respostas_tema ON respostas(tema);
CREATE INDEX IF NOT EXISTS idx_respostas_partida ON respostas(partida_id);
