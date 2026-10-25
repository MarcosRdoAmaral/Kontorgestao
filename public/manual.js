/**
 * Manual do usuário do Kontor Gestão (mostrado em Relatórios > Documentação).
 * REGRA DO PROJETO: toda funcionalidade nova ou alterada precisa atualizar o tópico correspondente
 * aqui (e a data/versão em MANUAL_VERSAO) antes de publicar a versão.
 * `corpo` é HTML escrito à mão (não recebe dados de usuário).
 */
export const MANUAL_VERSAO = '3.5.0';

export const MANUAL = [
  {
    id: 'primeiros-passos', titulo: 'Primeiros passos', resumo: 'Instalação, primeiro acesso e o que configurar antes de emitir.',
    corpo: `
      <p>O Kontor Gestão emite NFS-e pelo <strong>Emissor Nacional</strong> (Sefin Nacional), para várias empresas ao mesmo tempo, e cuida de boletos, despesas, extrato e relatórios.</p>
      <h3>Antes da primeira nota</h3>
      <ol>
        <li><strong>Primeiro acesso:</strong> informe o nome do escritório e crie o usuário administrador.</li>
        <li><strong>Licença:</strong> em Configurações &gt; Licença, cole o código recebido para liberar a emissão.</li>
        <li><strong>Empresa:</strong> em Empresas, cadastre cada prestador (CNPJ, regime, município, ambiente).</li>
        <li><strong>Certificado A1:</strong> na linha da empresa, botão Certificado (arquivo .pfx e senha). Empresas que emitem só pelo portal com CNPJ e senha não precisam dele (veja <em>Empresas</em>).</li>
        <li><strong>Serviços e clientes:</strong> cadastre os serviços prestados e os clientes (tomadores).</li>
        <li><strong>Teste:</strong> mantenha a empresa em <em>Produção restrita (testes)</em> até validar tudo; só depois mude o ambiente para produção.</li>
      </ol>
      <h3>Como o sistema é organizado</h3>
      <p>No alto do menu lateral fica a <strong>empresa selecionada</strong>: quase todas as telas mostram os dados dela. Troque a empresa ali a qualquer momento. O restante do menu segue o fluxo do dia a dia: emitir, acompanhar notas, cobrar, controlar despesas e consultar relatórios.</p>
      <p class="dica">O menu mostra só o que o seu usuário tem permissão de usar (Configurações &gt; Usuários e acessos). Este manual está liberado para todos os usuários: em Relatórios &gt; Documentação, ou no item Documentação do menu para quem não tem o acesso a Relatórios.</p>`,
  },
  {
    id: 'empresas', titulo: 'Empresas', resumo: 'Cadastro do prestador, certificado, logo, dados bancários e emissão sem certificado.',
    corpo: `
      <h3>Cadastrar</h3>
      <p>Em <strong>Empresas &gt; Cadastrar empresa</strong> informe o CNPJ (o botão de busca preenche razão social e endereço), o regime (não optante, MEI ou Simples ME/EPP), o município e o ambiente. Use <em>Produção restrita</em> para testes: as notas não têm valor fiscal.</p>
      <h3>Certificado A1</h3>
      <p>A API da Sefin exige certificado digital A1 da empresa. Na linha da empresa, <strong>Certificado</strong> envia o arquivo .pfx e a senha; o sistema guarda criptografado e mostra a validade. Renove antes de vencer.</p>
      <h3>Emissão sem certificado (CNPJ e senha)</h3>
      <p>Para empresas que emitem direto no portal do Emissor Nacional, escolha o modo <strong>Portal (CNPJ e senha)</strong> no cadastro. Nesse modo o sistema <em>não emite a nota</em>: você emite no portal e importa o XML em <strong>Notas emitidas &gt; Importar XML</strong>. Os boletos, as cobranças e os relatórios continuam funcionando normalmente. A senha do portal fica guardada criptografada.</p>
      <h3>Logo</h3>
      <p>O botão <strong>Logo</strong> envia a imagem que aparece no DANFSe (PDF da nota) dessa empresa.</p>
      <h3>Dados bancários</h3>
      <p>O botão <strong>Dados bancários</strong> da linha da empresa abre a configuração da cobrança (convênio Ailos): agência, conta, convênio, carteira, formato CNAB, numeração do próximo boleto e da próxima remessa, multa, juros, instrução e <em>feriados municipais</em>. Sem isso não é possível gerar boletos. Se já emitia boletos em outro sistema, informe o próximo número livre para o nosso número nunca repetir.</p>`,
  },
  {
    id: 'clientes', titulo: 'Clientes', resumo: 'Tomadores, forma de faturar, vencimento e serviços padrão.',
    corpo: `
      <p>Em <strong>Clientes</strong> ficam os tomadores de cada empresa. Informe o CNPJ/CPF (a busca preenche os dados), endereço e e-mail.</p>
      <h3>Como faturar</h3>
      <ul>
        <li><strong>Somente nota:</strong> emite a NFS-e.</li>
        <li><strong>Nota + boleto:</strong> emite a nota e gera o boleto.</li>
        <li><strong>Somente boleto:</strong> gera só a cobrança.</li>
      </ul>
      <h3>Vencimento</h3>
      <p>Por prazo (X dias após a emissão) ou em dia fixo do mês. Boleto não vence em sábado, domingo ou feriado: o sistema antecipa para o dia útil anterior.</p>
      <h3>Serviços padrão e agenda</h3>
      <p>Na aba <strong>Serviços padrão</strong> do cliente, cadastre o serviço e o valor que se repetem todo mês; eles alimentam a <em>Emissão automática</em>. Também é ali que se define o envio automático por e-mail.</p>`,
  },
  {
    id: 'servicos', titulo: 'Serviços e tributação', resumo: 'Cadastro do serviço, código nacional, NBS, retenções.',
    corpo: `
      <p>Em <strong>Serviços</strong> cadastre cada serviço prestado pela empresa selecionada: descrição que sai na nota, código de tributação nacional (cTribNac), alíquota e, se for o caso, NBS.</p>
      <h3>Tributação do serviço</h3>
      <p>O serviço <strong>não guarda mais</strong> alíquotas nem retenções: ele apenas aponta para um <strong>tipo de documento</strong> (campo <em>Tributação &gt; Tipo de documento</em>). Alíquota do ISS, ISSQN, imunidade, retenções (PIS, COFINS, CSLL, IRRF, INSS), totais aproximados, município e IBS/CBS ficam no perfil ligado ao tipo, em <strong>Tributação</strong>. Sem tipo, vale o tipo padrão de saída da empresa. Serviços antigos foram convertidos automaticamente em perfil e tipo.</p>
      <p class="dica">Confira sempre o enquadramento com o contador. O sistema só repete o que foi cadastrado.</p>`,
  },
  {
    id: 'emitir', titulo: 'Emitir nota', resumo: 'Passo a passo da emissão, F2 para clientes e boleto junto.',
    corpo: `
      <ol>
        <li>Abra <strong>Emitir nota</strong> (confira a empresa no alto do menu).</li>
        <li><strong>Cliente:</strong> comece a <strong>digitar o nome</strong> (ou o CNPJ/CPF): a lista se filtra enquanto você escreve; use as setas e Enter, ou clique no cliente. Apagar o campo volta para <em>Consumidor não identificado</em>. <kbd>F2</kbd> abre a consulta completa, em janela. Também dá para cadastrar um cliente novo ali mesmo.</li>
        <li><strong>Serviço:</strong> ao escolher, descrição e código são preenchidos e o <strong>tipo de documento</strong> do serviço é selecionado.</li>
        <li><strong>Tipo de documento:</strong> traz alíquota, ISSQN, retenções, totais aproximados, município e informações complementares do perfil (na data da competência). Trocar o tipo refaz o preenchimento; os campos ainda podem ser ajustados na nota.</li>
        <li>Informe competência, valor e, se precisar, ajuste descrição e retenções.</li>
        <li>Se o cliente fatura com boleto, defina o vencimento (já sugerido pela regra do cliente).</li>
        <li><strong>Emitir.</strong> O sistema monta a DPS, assina com o certificado e envia à Sefin.</li>
      </ol>
      <h3>Se algo der errado</h3>
      <ul>
        <li><strong>Rejeitada:</strong> a tela da nota mostra o código e o motivo. Use <em>Corrigir e reenviar</em>; o número da DPS é mantido.</li>
        <li><strong>Sem resposta da Sefin:</strong> use <em>Consultar na Sefin</em> antes de reenviar; a nota pode já ter sido gerada e é recuperada sem duplicar.</li>
      </ul>
      <p class="dica">Em produção restrita as notas são de teste e não têm valor fiscal.</p>`,
  },
  {
    id: 'notas', titulo: 'Notas emitidas', resumo: 'Consultar, baixar, enviar, cancelar, excluir e importar XML.',
    corpo: `
      <p>A lista mostra as notas da empresa com situação, número, cliente e valor. Clique na nota para ver o detalhe.</p>
      <h3>O que dá para fazer</h3>
      <ul>
        <li><strong>Abrir DANFSe</strong> (PDF) e <strong>baixar o XML</strong>.</li>
        <li><strong>Consultar no portal nacional</strong>.</li>
        <li><strong>Enviar por e-mail</strong> ou WhatsApp ao cliente (só notas de produção).</li>
        <li><strong>Cancelar nota:</strong> só para nota autorizada, com motivo de pelo menos 15 caracteres. A nota fica <em>Cancelada</em> e continua no histórico.</li>
        <li><strong>Excluir nota:</strong> só para nota <em>não autorizada</em> (rejeitada, pendente ou sem resposta). Nota autorizada ou cancelada <u>nunca</u> pode ser excluída. Os boletos ligados continuam no sistema. Só aparece para o administrador e para usuários com a permissão <em>Excluir registros</em>.</li>
        <li><strong>Importar XML:</strong> traz para o sistema notas emitidas fora (por exemplo, no portal, para empresas sem certificado).</li>
        <li><strong>Baixar em lote</strong> as notas de um período (PDF e XML).</li>
      </ul>
      <p class="dica">Dúvida se a Sefin gerou a nota? Use <em>Consultar na Sefin</em> antes de excluir uma nota pendente.</p>`,
  },
  {
    id: 'agenda', titulo: 'Emissão automática', resumo: 'Preparar as notas e boletos do mês e confirmar de uma vez.',
    corpo: `
      <p>Para clientes com cobrança todo mês. O sistema <strong>prepara</strong> a emissão na data de cada cliente, usando o serviço padrão e o valor cadastrados; <strong>nada é emitido sem a sua confirmação</strong>.</p>
      <h3>Configurar</h3>
      <ol>
        <li>Em <strong>Clientes</strong>, cadastre o serviço e o valor na aba Serviços padrão.</li>
        <li>Em <strong>Emissão automática</strong>, clique em <em>Agendar</em> no cliente e escolha o dia do mês.</li>
      </ol>
      <h3>No dia a dia</h3>
      <p>Escolha o mês. Cada item aparece como <em>Pronta</em>, <em>Agendada</em> (ainda não chegou a data), <em>Emitida</em>, <em>Com erro</em> ou <em>Pulada</em>. Use <em>Emitir</em> em um item, <strong>Emitir prontas</strong> para todos de uma vez, <em>Pular</em> para ignorar o mês ou <em>Tentar de novo</em> nos que deram erro. Conforme o cliente, gera nota, nota + boleto ou só boleto.</p>`,
  },
  {
    id: 'cobrancas', titulo: 'Cobranças e boletos', resumo: 'Boletos Ailos, remessa, retorno e baixas.',
    corpo: `
      <p>A tela <strong>Cobranças</strong> lista os boletos da empresa com situação (pendente, pronto, enviado ao banco, registrado, pago, cancelado).</p>
      <h3>Fluxo com o banco (Ailos)</h3>
      <ol>
        <li>Configure os <em>Dados bancários</em> da empresa (em Empresas).</li>
        <li>Os boletos são gerados na emissão, no faturamento automático ou como <strong>boleto avulso</strong>.</li>
        <li>Gere a <strong>remessa</strong> (arquivo CNAB) e envie no Ailos Conta Online: Cobrança Bancária &gt; Arquivo de Cobrança.</li>
        <li>Depois do pagamento, baixe o <strong>arquivo de retorno</strong> no mesmo menu e importe aqui para dar baixa automática.</li>
      </ol>
      <h3>Outras ações</h3>
      <ul>
        <li><strong>Boleto:</strong> abre o PDF para imprimir ou enviar. <strong>WhatsApp</strong> abre a mensagem pronta.</li>
        <li><strong>Marcar pago:</strong> baixa manual. <strong>Reemitir:</strong> altera vencimento ou valor. <strong>Cancelar:</strong> se já foi ao banco, a baixa vai na próxima remessa.</li>
      </ul>`,
  },
  {
    id: 'compras', titulo: 'Compras (NF-e de entrada)', resumo: 'Importar o XML da NF-e de compra e lançar nas despesas.',
    corpo: `
      <p>Em <strong>Compras</strong> ficam as notas fiscais de mercadorias que a empresa comprou. A tela mostra o mês escolhido, o total comprado e os maiores fornecedores.</p>
      <h3>Importar o XML da NF-e</h3>
      <ol>
        <li>Clique em <strong>Importar XML da NF-e</strong> e escolha um ou <em>vários</em> arquivos de uma vez (o XML que o fornecedor envia ou que se baixa no portal da NF-e).</li>
        <li>Deixe marcado <em>Lançar nas despesas</em> se quiser que cada parcela (duplicata) vire uma despesa na data de vencimento, na categoria escolhida; nota à vista vira uma despesa só.</li>
        <li>O resultado aparece arquivo por arquivo. O sistema lê fornecedor, itens (com NCM e CFOP), totais e parcelas.</li>
      </ol>
      <p>O sistema avisa e <strong>não importa</strong> quando a nota já foi importada, quando foi emitida pela própria empresa (é uma venda), ou quando o XML é de NFS-e ou de evento. Se o destinatário da nota for outro CNPJ, importa com um alerta para você conferir a empresa selecionada.</p>
      <h3>Compra manual</h3>
      <p><strong>Lançar compra manual</strong> registra uma compra sem XML (cupom, recibo): fornecedor, data, valor, vencimento e categoria.</p>
      <h3>Detalhe, XML e exclusão</h3>
      <p>Clique na compra para ver itens, totais e parcelas e baixar o XML. <strong>Excluir compra</strong> (permissão <em>Excluir registros</em>) apaga também as despesas que ela gerou. O relatório <em>Compras (NF-e de entrada)</em> está em Relatórios. O acesso a Compras é liberado por usuário em Configurações &gt; Usuários e acessos.</p>`,
  },
  {
    id: 'estoque', titulo: 'Estoque de insumos', resumo: 'Material de expediente e insumos: entradas, baixas e avisos no topo.',
    corpo: `
      <p>Em <strong>Estoque</strong> ficam os insumos usados na prestação dos serviços (papel, canetas, toner etc.). O saldo de cada item é a soma das entradas, baixas e ajustes.</p>
      <h3>Cadastrar e dar entrada</h3>
      <ul>
        <li><strong>Novo item:</strong> nome, unidade, categoria e <em>estoque mínimo</em> (quando o saldo chegar a esse valor o sistema avisa para comprar). Dá para informar um saldo inicial.</li>
        <li><strong>Pela compra:</strong> em <em>Compras</em>, abra a NF-e e clique em <strong>Lançar no estoque</strong>. Marque os itens que são insumos, ajuste nome/quantidade se precisar; itens com o mesmo nome somam no que já existe. Um item da nota só entra uma vez.</li>
        <li><strong>Entrada manual:</strong> botão <em>Entrada</em> na linha do item.</li>
      </ul>
      <h3>Dar baixa</h3>
      <p>Use <strong>Baixa</strong> sempre que retirar material, informando a quantidade, a data e, se quiser, onde foi usado. Não é possível baixar mais que o saldo. Se a contagem física diferir, use <strong>Contagem</strong> (inventário) e informe o saldo real: o sistema registra o ajuste.</p>
      <h3>Avisos no topo</h3>
      <ul>
        <li><strong>Precisa comprar</strong> (vermelho): saldo igual ou abaixo do mínimo, ou item zerado.</li>
        <li><strong>Comprado e sem uso</strong> (amarelo): entrou no estoque e está há 30 dias ou mais sem nenhuma baixa.</li>
      </ul>
      <p>O aviso aparece em todas as telas para quem tem a permissão <em>Estoque de insumos</em> e pode ser dispensado com o ×; volta se a situação mudar. O <strong>Histórico</strong> de cada item mostra todos os lançamentos.</p>`,
  },
  {
    id: 'tributacao', titulo: 'Tributação e apuração assistida', resumo: 'Impostos, perfis, tipos de documento e comparação com o que as notas declaram.',
    corpo: `
      <p>Em <strong>Tributação</strong> você cadastra os impostos uma vez, junta em <em>perfis</em>, liga cada <em>tipo de documento</em> a um perfil e só então vincula serviços e compras ao tipo.</p>
      <h3>1. Impostos</h3>
      <p>Catálogo pronto: ISS, ICMS, IPI, PIS, COFINS, CSLL, IRRF, INSS, IBS (estadual e municipal) e CBS. Dá para renomear e desativar o que a empresa não usa.</p>
      <h3>2. Perfis de tributação</h3>
      <p>Um perfil é um conjunto de linhas: imposto, alíquota, redução de base, se é <strong>retido</strong>, CST e cClassTrib (IBS/CBS) e a <strong>vigência</strong> (de/até). Como as alíquotas do IBS/CBS mudam ao longo da transição, use uma linha por período; vale a que está em vigor na data do documento.</p>
      <h3>3. Tipos de documento</h3>
      <p>Cada tipo define o sentido (<em>saída</em> ou <em>entrada</em>), o modelo (NFS-e, NF-e de compra, manual), a natureza (serviço, revenda, insumo, uso e consumo, ativo imobilizado, devolução), o perfil, o código padrão, se <em>gera crédito</em> e o destino financeiro. Marque um tipo como <strong>padrão</strong> do sentido para ele valer quando o serviço ou a compra não indicar nenhum.</p>
      <p>O botão <strong>Criar a partir dos serviços</strong> converte as retenções já cadastradas nos serviços em perfis e tipos, e vincula cada serviço.</p>
      <h3>4. Vínculos</h3>
      <ul>
        <li><strong>Serviço (saída):</strong> no cadastro do serviço, campo <em>Tipo de documento</em>. Com tipo, as retenções e o ISS retido passam a vir do perfil, tanto na tela de emissão quanto no XML da DPS.</li>
        <li><strong>Compra (entrada):</strong> ao importar o XML ou lançar manualmente, escolha o tipo (ou deixe o padrão).</li>
      </ul>
      <h3>5. Apuração assistida</h3>
      <p>Escolha o mês. Para cada imposto o sistema mostra <strong>débitos</strong> (notas emitidas), <strong>créditos</strong> (compras de tipos que geram crédito) e o saldo, lado a lado em <em>calculado</em> (perfil aplicado ao valor) e <em>XML</em> (o que a nota declarou, inclusive IBS e CBS). Retenções aparecem à parte. A lista de <strong>divergências</strong> aponta, documento a documento, onde o cálculo e o XML diferem em mais de R$ 0,05.</p>
      <p>O cálculo fica gravado no documento. Mudou um perfil? Use <strong>Recalcular</strong> para refazer o mês.</p>
      <p class="dica">É uma conferência assistida, não a apuração oficial: valide sempre com o contador. O acesso é liberado por usuário (permissão <em>Tributação e apuração</em>).</p>`,
  },
  {
    id: 'despesas', titulo: 'Despesas e balanço', resumo: 'Lançar despesas e acompanhar receitas × despesas.',
    corpo: `
      <p>Em <strong>Despesas e balanço</strong> lance as despesas da empresa por categoria e acompanhe o resultado do mês: o que foi <em>recebido</em> (boletos pagos) contra o que foi gasto. Marcar as cobranças como pagas e lançar as despesas mantém o balanço confiável. O <strong>Painel do mês</strong> resume faturado, recebido, a receber, em atraso e quem ainda falta emitir.</p>`,
  },
  {
    id: 'extrato', titulo: 'Extrato e conciliação', resumo: 'Importar o extrato em PDF, classificar e ligar aos boletos.',
    corpo: `
      <p>Hoje o sistema lê o extrato em PDF do <strong>Ailos</strong> (outros bancos entram depois).</p>
      <ol>
        <li>Em <strong>Extrato e conciliação</strong>, clique em <em>Importar extrato (PDF)</em>. O sistema confere o total lido com o saldo do próprio extrato.</li>
        <li><strong>Classifique</strong> entradas e saídas por categoria. Regras aprendem com o que você classifica e valem para lançamentos parecidos.</li>
        <li>Nas entradas, use <strong>Ligar a boleto</strong> para conciliar o recebimento com o boleto (aparecem os boletos de valor compatível, mesmo com vencimento diferente da data do crédito).</li>
        <li>O balanço do mês só fecha quando não há lançamentos sem classificação.</li>
      </ol>
      <p class="dica">Importar o mesmo extrato duas vezes não duplica os lançamentos. Uma importação errada pode ser excluída na lista de importações.</p>`,
  },
  {
    id: 'relatorios', titulo: 'Relatórios', resumo: 'Os relatórios disponíveis e qual data cada um usa.',
    corpo: `
      <p>A nota é emitida em um dia, o boleto vence em outro e é pago em outro. Por isso cada relatório informa <strong>qual data filtra o período</strong> e mostra as demais nas colunas.</p>
      <ul>
        <li><strong>Receitas emitidas:</strong> por data de emissão da nota.</li>
        <li><strong>Contas a receber por vencimento.</strong></li>
        <li><strong>Em aberto por data de emissão.</strong></li>
        <li><strong>Recebimentos:</strong> por data de pagamento.</li>
        <li><strong>Saldo vencido por cliente</strong> (faixas de atraso) e <strong>Posição por cliente</strong>.</li>
        <li><strong>Notas emitidas e tributos:</strong> ISS e retenções.</li>
        <li><strong>Fluxo de caixa por categoria:</strong> a partir do extrato importado.</li>
        <li><strong>Compras (NF-e de entrada):</strong> por data de emissão da nota.</li>
      </ul>
      <p>Escolha o relatório, o período, o cliente e a situação (quando houver) e clique em <em>Gerar</em>. Exporte para <strong>Excel (CSV)</strong> ou <strong>PDF</strong>.</p>`,
  },
  {
    id: 'contabilidade', titulo: 'Exportar para a contabilidade', resumo: 'Pacote com extrato em OFX, PDF e XML das notas.',
    corpo: `
      <p>Em <strong>Configurações &gt; Contabilidade</strong> (administrador) escolha a empresa e o mês. O sistema gera um pacote ZIP com o extrato convertido em <strong>OFX</strong>, o extrato em <strong>PDF</strong> e os <strong>XML</strong> de todas as notas emitidas no período, pronto para enviar ao contador.</p>`,
  },
  {
    id: 'configuracoes', titulo: 'Configurações', resumo: 'Usuários, e-mail, aparência, backup, licença e atualizações.',
    corpo: `
      <ul>
        <li><strong>Minha conta:</strong> altere sua senha.</li>
        <li><strong>Usuários e acessos</strong> (administrador): crie usuários e libere por usuário as funcionalidades (emissão, notas, cobranças, relatórios etc.) e as empresas que cada um enxerga. A permissão <strong>Excluir registros</strong> é separada das demais: sem ela o usuário não vê nem consegue usar nenhuma exclusão (nota não autorizada, serviço, despesa, importação de extrato), mesmo tendo acesso à tela. O administrador sempre pode.</li>
        <li><strong>E-mail:</strong> servidor SMTP usado para enviar notas e boletos aos clientes e para a recuperação de senha.</li>
        <li><strong>Aparência:</strong> escolha entre <em>Preto e laranja</em>, <em>Branco e laranja</em> e <em>Azul e dourado</em>. Vale para o computador.</li>
        <li><strong>Backup:</strong> o sistema faz cópia automática diária; também dá para baixar um backup quando quiser. Guarde uma cópia fora do computador.</li>
        <li><strong>Licença:</strong> mostra a situação e permite informar um novo código. Nos <strong>15 dias</strong> antes do vencimento (da licença ou do período de teste) o menu mostra "Licença vence em N dia(s)" em destaque e o sistema abre um aviso uma vez por dia, com o código do computador para pedir a renovação. Vencida a licença, só a emissão é bloqueada.</li>
        <li><strong>Atualizações:</strong> o sistema baixa novas versões e pede para reiniciar; os dados são preservados.</li>
      </ul>`,
  },
  {
    id: 'atalhos', titulo: 'Atalhos e dicas', resumo: 'Atalhos de teclado e boas práticas.',
    corpo: `
      <ul>
        <li>Em Emitir nota, digite no campo do cliente para buscar na hora; <kbd>F2</kbd> abre a consulta completa (setas, Enter para escolher, Esc para fechar).</li>
        <li>Confira sempre a <strong>empresa selecionada</strong> no alto do menu antes de emitir.</li>
        <li>Teste primeiro em <em>Produção restrita</em>.</li>
        <li>Mantenha backup fora do computador e renove o certificado A1 antes do vencimento.</li>
      </ul>`,
  },
  {
    id: 'problemas', titulo: 'Problemas comuns', resumo: 'O que fazer nos erros mais frequentes.',
    corpo: `
      <dl class="faq">
        <dt>"Cadastre o certificado A1 da empresa antes de emitir"</dt><dd>Envie o certificado em Empresas &gt; Certificado, ou mude a empresa para o modo Portal se ela emite sem certificado.</dd>
        <dt>Nota rejeitada</dt><dd>Leia o código e o motivo na tela da nota, corrija os dados em <em>Corrigir e reenviar</em>. Se não for possível corrigir, exclua a nota rejeitada e emita outra.</dd>
        <dt>A Sefin não respondeu</dt><dd>Use <em>Consultar na Sefin</em> na nota. Se ela existir, é recuperada; senão, reenvie.</dd>
        <dt>Não consigo gerar boleto</dt><dd>Falta preencher os Dados bancários da empresa (Empresas &gt; Dados bancários).</dd>
        <dt>Não encontro uma opção no menu</dt><dd>Seu usuário pode não ter a permissão; peça ao administrador em Configurações &gt; Usuários e acessos.</dd>
        <dt>Extrato não confere</dt><dd>O sistema compara o total lido com o do PDF e avisa a diferença; confirme se o PDF é do Ailos e do período completo.</dd>
      </dl>`,
  },
];
