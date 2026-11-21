
const { app, BrowserWindow } = require('electron');
const { startServer } = require('./server');

let mainWindow;

app.whenReady().then(async () => {
  await startServer(Number(process.env.PORT || 4173));

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL('http://localhost:4173');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
