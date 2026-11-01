# Integração Cora — plano de implementação

> Execução nativa, tarefa a tarefa. Spec: `docs/superpowers/specs/2026-11-01-cora-integracao-design.md`.

**Objetivo:** emitir, baixar, cancelar e conciliar boletos (com Pix) e ler extrato da Cora pela API.
**Arquitetura:** tabela própria `contas_cora` (em vez de colunas em `contas_bancarias`, que exigem agência/convênio do Ailos); cliente HTTP em `src/cobranca/cora.ts`; regras em `src/servicos/cora.ts`; a emissão é assíncrona (cobrança nasce `AGUARDANDO_BANCO` e é registrada logo em seguida), sem mexer nos pontos que chamam `criarCobranca`.
**Restrições:** valores em centavos, mínimo R$ 5; `Idempotency-Key` guardada na cobrança; chave privada cifrada com `cifrarTexto` e nunca devolvida; URL da API trocável por `CORA_URL_TESTE` nos testes.

## Revisão do spec
- Troca: `contas_cora` separada (justificativa acima). Cora ativa tem precedência para novas cobranças; as do Ailos já emitidas seguem por remessa/retorno.
- Erros 4xx não são repetidos sozinhos (aparece o motivo na cobrança); rede/5xx são repetidos pelo temporizador.
- Desconto por pontualidade só vai à Cora quando vale até o vencimento (a API não tem data de desconto).

## Tarefas
1. **Cliente da API** (`src/cobranca/cora.ts`): token em cache, mTLS, `emitir`, `consultar`, `listarPagos`, `cancelar`, `extrato`. Teste com servidor HTTP falso.
2. **Conta e emissão** (`src/servicos/cora.ts`, migração 30): salvar/ler credenciais (valida par certificado/chave), `emitirNaCora`, gancho em `criarCobranca`, PDF do boleto pela Cora.
3. **Baixa, cancelamento e reemissão**: `sincronizarPagos`, `cancelarNaCora`, rota de cancelar/reemitir assíncrona.
4. **Extrato e saldo**: `sincronizarExtrato` grava em `extrato_lancamentos` (`importarLancamentosExternos` em `extrato.ts`).
5. **Rotas, permissões e temporizador**: `/api/empresas/:id/cora` (GET/PUT/DELETE), `/testar`, `/sincronizar`; ciclo de 10 min em `server.ts`.
6. **Tela**: Dados bancários (escolha Cora), botão "Atualizar" em Cobranças e Extrato, saldo.
7. **Versão 3.30.0**: manual (passo a passo das credenciais), novidades, testes `# fail 0`, publicação.
8. **Contabilidade**: mesma implementação em 1.30.0.

## Foco da revisão
Falha de rede sem duplicar boleto; valor abaixo de R$ 5; cliente sem CPF/CNPJ ou endereço; baixa repetida; cancelar boleto já pago; token expirado (401).
