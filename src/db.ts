import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

/**
 * SQLite embutido no Node (node:sqlite): não exige módulo nativo, então o mesmo código
 * roda no servidor e dentro do aplicativo de desktop (Electron) sem recompilar nada.
 * Esta camada mantém a interface usada no resto do sistema: prepare/run/get/all, pragma e transaction.
 */
class Banco {
  private conn = new DatabaseSync(config.databasePath);

  exec(sql: string) {
    this.conn.exec(sql);
  }

  prepare(sql: string) {
    const st: StatementSync = this.conn.prepare(sql);
    return {
      run: (...p: any[]) => st.run(...p),
      get: (...p: any[]) => st.get(...p) as any,
      all: (...p: any[]) => st.all(...p) as any[],
    };
  }

  pragma(texto: string, opcoes?: { simple?: boolean }) {
    if (opcoes?.simple) {
      const linha = this.conn.prepare(`PRAGMA ${texto}`).get() as Record<string, unknown> | undefined;
      return linha ? Object.values(linha)[0] : undefined;
    }
    this.conn.exec(`PRAGMA ${texto}`);
  }

  /** Executa fn dentro de uma transação; desfaz tudo se lançar erro. */
  transaction<A extends any[], R>(fn: (...a: A) => R) {
    return (...a: A): R => {
      this.conn.exec('BEGIN IMMEDIATE');
      try {
        const r = fn(...a);
        this.conn.exec('COMMIT');
        return r;
      } catch (e) {
        this.conn.exec('ROLLBACK');
        throw e;
      }
    };
  }

  /** Cópia consistente do banco (usada no backup), mesmo com o sistema em uso. */
  copiarPara(destino: string) {
    if (fs.existsSync(destino)) fs.rmSync(destino);
    this.conn.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  }
}

export const db = new Banco();
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Migrações em ordem. Cada uma roda uma única vez (controle por user_version).
 * Modelo multi-escritório desde o início: cada registro pertence a um escritório,
 * o que permite virar SaaS depois sem refazer o banco.
 */
const migracoes: string[] = [
  `
  CREATE TABLE escritorios (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    cnpj TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin','operador','cliente')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE empresas (
    id INTEGER PRIMARY KEY,
    escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
    documento TEXT NOT NULL,                 -- CNPJ (14, aceita alfanumérico) ou CPF (11)
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    inscricao_municipal TEXT,
    cod_municipio TEXT NOT NULL,             -- IBGE 7 dígitos (cLocEmi)
    uf TEXT,
    email TEXT,
    op_simp_nac INTEGER NOT NULL DEFAULT 3,  -- 1 Não optante, 2 MEI, 3 ME/EPP
    reg_ap_trib_sn INTEGER,                  -- 1, 2 ou 3 (só para opSimpNac=3)
    reg_esp_trib INTEGER NOT NULL DEFAULT 0,
    p_tot_trib_sn REAL,                      -- % aproximado de tributos do Simples (Lei 12.741)
    ambiente INTEGER NOT NULL DEFAULT 2 CHECK (ambiente IN (1,2)),
    serie TEXT NOT NULL DEFAULT '1',
    cert_pfx_enc BLOB,
    cert_senha_enc TEXT,
    cert_titular TEXT,
    cert_validade TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (escritorio_id, documento)
  );

  CREATE TABLE usuario_empresas (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, empresa_id)
  );

  CREATE TABLE sequencias_dps (
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    ambiente INTEGER NOT NULL,
    serie TEXT NOT NULL,
    ultimo_numero INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (empresa_id, ambiente, serie)
  );

  CREATE TABLE tomadores (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tipo_doc TEXT NOT NULL CHECK (tipo_doc IN ('CPF','CNPJ','SEM')),
    documento TEXT,
    nome TEXT NOT NULL,
    inscricao_municipal TEXT,
    email TEXT,
    fone TEXT,
    cep TEXT,
    cod_municipio TEXT,
    logradouro TEXT,
    numero TEXT,
    complemento TEXT,
    bairro TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_tomadores_empresa ON tomadores(empresa_id);

  CREATE TABLE servicos (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome TEXT NOT NULL,                      -- apelido interno ("Consultoria mensal")
    descricao TEXT NOT NULL,                 -- xDescServ padrão
    c_trib_nac TEXT NOT NULL,                -- 6 dígitos
    c_trib_mun TEXT,                         -- 3 dígitos (desdobro municipal, quando houver)
    c_nbs TEXT,                              -- 9 dígitos
    aliquota REAL,                           -- pAliq (%), quando exigida
    valor_padrao REAL,
    ibscbs_json TEXT,                        -- grupo IBS/CBS opcional (regime regular)
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_servicos_empresa ON servicos(empresa_id);

  CREATE TABLE notas (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tomador_id INTEGER REFERENCES tomadores(id),
    servico_id INTEGER REFERENCES servicos(id),
    ambiente INTEGER NOT NULL,
    serie TEXT NOT NULL,
    n_dps INTEGER NOT NULL,
    id_dps TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('PENDENTE','AUTORIZADA','REJEITADA','ERRO_COMUNICACAO','CANCELADA')),
    competencia TEXT NOT NULL,
    valor_servico REAL NOT NULL,
    descricao TEXT NOT NULL,
    tomador_nome TEXT,
    tomador_documento TEXT,
    payload_json TEXT NOT NULL,
    xml_dps TEXT,
    xml_nfse TEXT,
    chave_acesso TEXT UNIQUE,
    n_nfse TEXT,
    erros_json TEXT,
    alertas_json TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    autorizada_em TEXT,
    cancelada_em TEXT,
    UNIQUE (empresa_id, ambiente, serie, n_dps)
  );
  CREATE INDEX ix_notas_empresa ON notas(empresa_id, criado_em);

  CREATE TABLE eventos (
    id INTEGER PRIMARY KEY,
    nota_id INTEGER NOT NULL REFERENCES notas(id),
    tipo TEXT NOT NULL,
    status TEXT NOT NULL,
    motivo TEXT,
    xml_pedido TEXT,
    xml_retorno TEXT,
    erros_json TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE log_comunicacao (
    id INTEGER PRIMARY KEY,
    nota_id INTEGER REFERENCES notas(id),
    metodo TEXT NOT NULL,
    url TEXT NOT NULL,
    status_http INTEGER,
    resposta TEXT,
    duracao_ms INTEGER,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 2: logo da empresa para o DANFSe
  `ALTER TABLE empresas ADD COLUMN logo BLOB;`,
  // 3: lembra a última empresa escolhida por usuário
  `ALTER TABLE usuarios ADD COLUMN ultima_empresa_id INTEGER;`,
  // 4: envio de NFS-e por e-mail (SMTP do escritório, senha criptografada) + histórico
  `ALTER TABLE escritorios ADD COLUMN smtp_enc TEXT;
  CREATE TABLE emails_enviados (
    id INTEGER PRIMARY KEY,
    nota_id INTEGER NOT NULL REFERENCES notas(id),
    para TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ENVIADO','ERRO')),
    erro TEXT,
    enviado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_emails_nota ON emails_enviados(nota_id);`,
];

export function migrar(): void {
  const atual = db.pragma('user_version', { simple: true }) as number;
  if (atual > 0 && atual < migracoes.length) {
    // cópia de segurança antes de atualizar a estrutura do banco
    try {
      const pasta = path.join(path.dirname(config.databasePath), 'antes-de-atualizar');
      fs.mkdirSync(pasta, { recursive: true });
      db.copiarPara(path.join(pasta, `nfse-v${atual}-${new Date().toISOString().slice(0, 10)}.db`));
    } catch { /* não impede a atualização */ }
  }
  for (let i = atual; i < migracoes.length; i++) {
    db.transaction(() => {
      db.exec(migracoes[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
