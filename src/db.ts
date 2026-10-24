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
  // 5: faturamento por cliente (nota / nota + boleto / só boleto) e cobranças (boleto ainda sem banco)
  `ALTER TABLE tomadores ADD COLUMN modo_faturamento TEXT NOT NULL DEFAULT 'NOTA' CHECK (modo_faturamento IN ('NOTA','NOTA_BOLETO','BOLETO'));
  ALTER TABLE tomadores ADD COLUMN vencimento_tipo TEXT NOT NULL DEFAULT 'PRAZO' CHECK (vencimento_tipo IN ('PRAZO','DIA_FIXO'));
  ALTER TABLE tomadores ADD COLUMN vencimento_valor INTEGER NOT NULL DEFAULT 10;
  ALTER TABLE tomadores ADD COLUMN email_cobranca TEXT;
  ALTER TABLE tomadores ADD COLUMN enviar_email_auto INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE cobrancas (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tomador_id INTEGER NOT NULL REFERENCES tomadores(id),
    nota_id INTEGER REFERENCES notas(id),
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AGUARDANDO_BANCO' CHECK (status IN ('AGUARDANDO_BANCO','EMITIDO','PAGO','CANCELADO')),
    nosso_numero TEXT,
    linha_digitavel TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_cobrancas_empresa ON cobrancas(empresa_id, vencimento);
  CREATE INDEX idx_cobrancas_nota ON cobrancas(nota_id);`,
  // 6: controle de licença (código de ativação por computador, teste de 30 dias)
  `CREATE TABLE licenca (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    codigo TEXT,
    cliente TEXT,
    ate TEXT,
    ativada_em TEXT,
    inicio_teste TEXT,
    ultimo_visto TEXT,
    maquina_alt TEXT
  );`,
  // 7: cobrança bancária Ailos (conta, boletos, remessas e retornos)
  `ALTER TABLE tomadores ADD COLUMN cidade TEXT;
  ALTER TABLE tomadores ADD COLUMN uf TEXT;
  CREATE TABLE contas_bancarias (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    banco TEXT NOT NULL DEFAULT '085',
    cooperativa_nome TEXT NOT NULL DEFAULT 'AILOS',
    agencia TEXT NOT NULL, agencia_dv TEXT NOT NULL,
    conta TEXT NOT NULL, conta_dv TEXT NOT NULL,
    convenio TEXT NOT NULL,
    carteira TEXT NOT NULL DEFAULT '01',
    multa_pct REAL NOT NULL DEFAULT 2,
    juros_pct_mes REAL NOT NULL DEFAULT 1,
    instrucoes TEXT,
    proximo_boleto INTEGER NOT NULL DEFAULT 1,
    proxima_remessa INTEGER NOT NULL DEFAULT 1,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE remessas (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    numero INTEGER NOT NULL,
    nome_arquivo TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    qtd_titulos INTEGER NOT NULL,
    valor_total REAL NOT NULL,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_remessas_empresa ON remessas(empresa_id, id);
  CREATE TABLE cobrancas_nova (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tomador_id INTEGER NOT NULL REFERENCES tomadores(id),
    nota_id INTEGER REFERENCES notas(id),
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    vencimento TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AGUARDANDO_BANCO' CHECK (status IN ('AGUARDANDO_BANCO','A_REMETER','REMETIDO','REGISTRADO','REJEITADO','PAGO','CANCELADO')),
    emissao TEXT,
    numero_boleto INTEGER,
    nosso_numero TEXT,
    linha_digitavel TEXT,
    codigo_barras TEXT,
    remessa_id INTEGER REFERENCES remessas(id),
    baixa_pendente INTEGER NOT NULL DEFAULT 0,
    pago_em TEXT,
    valor_pago REAL,
    observacao_banco TEXT,
    email_status TEXT,
    email_para TEXT,
    email_em TEXT,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO cobrancas_nova (id, empresa_id, tomador_id, nota_id, descricao, valor, vencimento, status, nosso_numero, linha_digitavel, criado_por, criado_em)
    SELECT id, empresa_id, tomador_id, nota_id, descricao, valor, vencimento,
      CASE status WHEN 'EMITIDO' THEN 'A_REMETER' ELSE status END, nosso_numero, linha_digitavel, criado_por, criado_em FROM cobrancas;
  DROP TABLE cobrancas;
  ALTER TABLE cobrancas_nova RENAME TO cobrancas;
  CREATE INDEX idx_cobrancas_empresa ON cobrancas(empresa_id, vencimento);
  CREATE INDEX idx_cobrancas_nota ON cobrancas(nota_id);
  CREATE UNIQUE INDEX idx_cobrancas_nosso ON cobrancas(empresa_id, nosso_numero) WHERE nosso_numero IS NOT NULL;`,
  // 8: layout do arquivo de cobrança (CNAB 400 é o padrão do Ailos; CNAB 240 também suportado)
  `ALTER TABLE contas_bancarias ADD COLUMN layout TEXT NOT NULL DEFAULT 'CNAB400' CHECK (layout IN ('CNAB400','CNAB240'));`,
  // 9: acesso por usuário (nome em maiúsculas), tipos adm/normal, permissões por módulo, troca obrigatória de senha, usuário master
  `ALTER TABLE usuarios ADD COLUMN login TEXT;
  ALTER TABLE usuarios ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal' CHECK (tipo IN ('adm','normal'));
  ALTER TABLE usuarios ADD COLUMN permissoes TEXT;            -- JSON com os módulos liberados (NULL = todos os módulos de trabalho)
  ALTER TABLE usuarios ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usuarios ADD COLUMN mestre INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usuarios ADD COLUMN sessao_v INTEGER NOT NULL DEFAULT 0;   -- muda ao trocar/redefinir a senha e encerra sessões antigas
  UPDATE usuarios SET tipo = CASE WHEN papel = 'admin' THEN 'adm' ELSE 'normal' END;
  UPDATE usuarios SET login = upper(substr(email, 1, instr(email || '@', '@') - 1));
  UPDATE usuarios SET login = login || id WHERE EXISTS (SELECT 1 FROM usuarios u2 WHERE u2.login = usuarios.login AND u2.id < usuarios.id);
  CREATE UNIQUE INDEX idx_usuarios_login ON usuarios(login);
  CREATE TABLE recuperacao_senha (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    expira_em INTEGER NOT NULL,
    tentativas INTEGER NOT NULL DEFAULT 0,
    pedidos_em TEXT NOT NULL DEFAULT '[]'
  );`,
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
