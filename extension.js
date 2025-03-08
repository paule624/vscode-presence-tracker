const vscode = require("vscode");
const axios = require("axios");

let statusBarItem;

function activate(context) {
  // Crée un StatusBarItem et l'ajoute à la barre de statut
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.text = "Extension activée !";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commande simple pour tester l'activation
  let disposable = vscode.commands.registerCommand("extension.sayHello", () => {
    vscode.window.showInformationMessage("Hello from your extension!");
  });

  context.subscriptions.push(disposable);

  // Listener pour détecter l'enregistrement d'un fichier
  vscode.workspace.onDidSaveTextDocument((document) => {
    const fileName = document.fileName;
    const workspaceName = vscode.workspace.name || "No Workspace";

    // Mise à jour du StatusBarItem lors de l'enregistrement
    statusBarItem.text = `📁 ${workspaceName} | Fichier enregistré : ${fileName
      .split("/")
      .pop()}`;
    console.log(
      `Fichier enregistré : ${fileName} dans l'espace : ${workspaceName}`
    );

    // Envoie des données à l'API après l'enregistrement
    sendStatusToAPI(workspaceName, fileName);
  });

  console.log("Extension VS Code Status Sync activée !");
}

function deactivate() {
  console.log("Extension désactivée");
}

// Fonction pour envoyer les données à l'API
async function sendStatusToAPI(workspace, file) {
  try {
    await axios.post("https://votre-api.com/status", {
      workspace,
      file,
      timestamp: new Date().toISOString(),
    });
    console.log("Données envoyées à l’API avec succès !");
  } catch (error) {
    console.error(
      "Erreur lors de l’envoi des données à l’API :",
      error.message
    );
    // Mise à jour du StatusBarItem en cas d'erreur
    statusBarItem.text = "❌ Erreur lors de l'envoi des données à l'API";
  }
}

module.exports = {
  activate,
  deactivate,
};
