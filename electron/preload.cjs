const { contextBridge } = require('electron');
// Sinaliza para a interface que está rodando como aplicativo instalado.
contextBridge.exposeInMainWorld('nfseDesktop', true);
