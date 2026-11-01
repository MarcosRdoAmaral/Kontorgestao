# Integração com o banco Cora (Gestão Empresas e Gestão Contabilidade)

## Objetivo
Cada empresa pode usar uma conta Cora. O sistema emite boleto com Pix pela API, dá baixa sozinho quando pagam, traz extrato e saldo, e cancela ou reemite pela API. O Ailos (CNAB) continua como está. O Gestão Empresas é feito primeiro; o Gestão Contabilidade recebe a mesma implementação em versão seguinte.

## Decisões aprovadas
- Abordagem: Cora como segunda carteira da conta bancária da empresa (banco `Ailos` ou `Cora`). Sem mudar cadastro de cliente nem faturamento.
- Baixa por consulta periódica (10 min), sem webhook: o sistema roda no computador do cliente, sem endereço público.
- Ainda não existe conta Cora com API habilitada para teste. Desenvolvimento contra API simulada; validação real fica pendente (ver Riscos).

## Fatos da API (documentação Cora, integração direta)
- Base: `https://matls-clients.api.cora.com.br` (produção) e `https://matls-clients.api.stage.cora.com.br` (teste). Credenciais de teste e produção são distintas.
- Token: `POST /token`, mTLS (certificado + chave privada), form `grant_type=client_credentials&client_id=...`. Vale 24 h, sem refresh.
- Emitir: `POST /v2/invoices` com `Idempotency-Key` (UUID). Valores em centavos, mínimo R$ 5. Corpo: `code`, `customer` (name, email, document, address), `services[]`, `payment_terms` (due_date, fine, interest, discount), `payment_forms` (BANK_SLIP, PIX), `notification`. Resposta: `id`, `status`, `payment_options.bank_slip` (barcode, digitable, url, our_number), `pix.emv`.
- Situações: DRAFT, OPEN, INITIATED, IN_PAYMENT, LATE, PAID, CANCELLED.
- Consultar: `GET /v2/invoices/{id}` e `GET /v2/invoices?state&start&end&page&perPage` (máx. 200). Pago: `total_paid`, `occurrence_date`.
- Cancelar: `DELETE /v2/invoices/{id}` (204; 422 `REC-0006` se já pago).
- Extrato: `GET /bank-statement/statement?start&end&type&page&perPage` (máx. 500), com saldo em `start`/`end`.
- Não há alteração de vencimento ou valor: cancelar e emitir outro.

## Componentes
1. **Credenciais.** Em Dados bancários, escolher banco Cora e informar `client_id`, certificado, chave privada e ambiente. Chave e certificado ficam criptografados no cofre já usado pelos certificados A1 (`src/cofre.ts`). Botão "Testar conexão" (token + saldo).
2. **Cliente da API** `src/cobranca/cora.ts`: token em cache, mTLS via `https.Agent`, idempotência, erros claros, conversão de centavos.
3. **Emissão.** Para conta Cora, `gerarTitulo` chama a API; a cobrança vai de `AGUARDANDO_BANCO` direto a `REGISTRADO`, guardando id Cora, linha digitável, código de barras, Pix copia e cola e link do PDF. Multa, juros e desconto pontual do cliente vão para `payment_terms`. Antes de emitir, valida CPF/CNPJ, endereço e valor mínimo. Cliente de forma PIX usa só `payment_forms: PIX`.
4. **Baixa automática.** Temporizador de 10 min (como a busca de NF-e) consulta boletos `PAID` desde a última sincronização e chama `marcarPago` com data e valor pagos. Botão "Atualizar agora".
5. **Extrato e saldo.** Sincronização manual e automática para a mesma tabela `extrato_lancamentos` (categoria automática e conciliação existentes). Saldo no painel.
6. **Cancelar e reemitir.** Cancelar chama o `DELETE`; mudar vencimento ou valor cancela e emite outro (fluxo `reemitirCobranca`), avisando o usuário. Cobrança paga não cancela.
7. **Banco de dados.** Uma migração: `contas_bancarias` ganha `provedor`, `cora_ambiente`, `cora_client_id`, `cora_cert`, `cora_chave` (cifrados), `cora_ultima_sync`; `cobrancas` ganha `cora_id`, `cora_pdf_url`.
8. **Manual e novidades** com o passo a passo para pedir as credenciais no app da Cora.

## Erros e segurança
- Falha de rede ao emitir não duplica: a mesma `Idempotency-Key` é reutilizada na nova tentativa (guardada na cobrança).
- Token expirado ou 401: renova uma vez e repete.
- Chave privada nunca volta para a tela nem para logs.

## Testes
API simulada (servidor HTTPS local ou substituição do cliente): token, emitir, valor mínimo, repetição com idempotência, consulta paga, baixa duas vezes, cancelar, pago não cancela, extrato com paginação e saldo.

## Riscos
- Sem conta Cora de teste, o contrato real só é validado depois: primeira emissão no ambiente de teste da Cora precisa ser feita pelo usuário com credenciais suas. Campos podem divergir da documentação (ex.: endereço obrigatório, formato do `complement`).
- A documentação não detalha o escopo exigido nem limites de uso; ajustar após o primeiro teste real.

## Fora do escopo
Webhook, pagamento de contas, transferências, carnê, SMS, recorrência da Cora.
