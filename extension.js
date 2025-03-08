const vscode = require("vscode");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

let statusBarItem;
let startTime;
let currentWorkspace;
let timeSpentPerWorkspace = {};
let projects = [];

// Fonction pour charger les projets
async function loadProjects() {
  try {
    const projectsPath = path.join(__dirname, "projects.json");
    const data = await fs.readFile(projectsPath, "utf8");
    projects = JSON.parse(data).projects;
    console.log("Projets chargés:", projects);
  } catch (error) {
    console.error("Erreur lors du chargement des projets:", error);
    projects = [];
  }
}

// Fonction pour sauvegarder les projets
async function saveProjects() {
  try {
    const projectsPath = path.join(__dirname, "projects.json");
    await fs.writeFile(projectsPath, JSON.stringify({ projects }, null, 2));
    console.log("Projets sauvegardés");
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des projets:", error);
  }
}

// Fonction pour mettre à jour le temps d'un projet
async function updateProjectTime(gitUrl, timeSpent) {
  try {
    // Formatter le temps en "X h Ymin"
    const hours = Math.floor(timeSpent / 60);
    const minutes = Math.floor(timeSpent % 60);
    const formattedTime = `${hours} h ${minutes}min`;

    // Envoyer au portfolio
    await axios.post("http://localhost:5173/api/projects/update", {
      github: gitUrl,
      hoursSpent: formattedTime,
      lastUpdated: new Date().toISOString(),
    });

    console.log("Temps mis à jour dans le portfolio:", formattedTime);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du portfolio:", error);
  }
}

function activate(context) {
  // Charger les projets au démarrage
  loadProjects();

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

  // Initialiser le temps de début et le workspace actuel
  startTime = new Date();
  currentWorkspace = vscode.workspace.name || "No Workspace";
  if (!timeSpentPerWorkspace[currentWorkspace]) {
    timeSpentPerWorkspace[currentWorkspace] = 0;
  }

  // Listener pour détecter l'enregistrement d'un fichier
  vscode.workspace.onDidSaveTextDocument((document) => {
    const fileName = document.fileName;
    const workspaceName = vscode.workspace.name || "No Workspace";

    // Si vous devez utiliser Buffer, utilisez les nouvelles méthodes

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

  // Sauvegarder les projets au démarrage
  saveProjects();

  // Listener pour détecter le changement de dossier racine
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const newWorkspace = vscode.workspace.name || "No Workspace";
    if (newWorkspace !== currentWorkspace) {
      const endTime = new Date();
      const timeSpent = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // en minutes
      timeSpentPerWorkspace[currentWorkspace] += timeSpent;
      sendTimeToAPI(currentWorkspace, timeSpentPerWorkspace[currentWorkspace]);
      currentWorkspace = newWorkspace;
      startTime = new Date();
      if (!timeSpentPerWorkspace[currentWorkspace]) {
        timeSpentPerWorkspace[currentWorkspace] = 0;
      }
    }
  });

  console.log("Extension VS Code Status Sync activée !");
}

function deactivate() {
  const endTime = new Date();
  const timeSpent = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // en minutes
  timeSpentPerWorkspace[currentWorkspace] += timeSpent;
  sendTimeToAPI(currentWorkspace, timeSpentPerWorkspace[currentWorkspace]);
  console.log("Extension désactivée");
}

// Fonction pour envoyer les données à l'API
async function sendStatusToAPI(workspace, file) {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders
      ? workspaceFolders[0].uri.fsPath
      : null;
    const gitUrl = await getGitUrl(workspacePath);

    await axios.post("http://localhost:5173/status", {
      workspace,
      file,
      gitUrl,
      timestamp: new Date().toISOString(),
    });
    console.log("Données envoyées à l'API avec succès !");
    statusBarItem.text = `📁 ${workspace} | Git: ${gitUrl || "No Git URL"}`;
  } catch (error) {
    console.error(
      "Erreur lors de l'envoi des données à l'API :",
      error.message
    );
    statusBarItem.text = "❌ Erreur lors de l'envoi des données à l'API";
  }
}

// Fonction pour envoyer le temps passé à l'API
async function sendTimeToAPI(workspace, timeSpent) {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders
      ? workspaceFolders[0].uri.fsPath
      : null;
    const gitUrl = await getGitUrl(workspacePath);
    const formattedTime = formatTime(timeSpent);

    await axios.post("http://localhost:5173/time", {
      workspace,
      timeSpent: formattedTime,
      gitUrl,
      timestamp: new Date().toISOString(),
    });

    if (gitUrl) {
      await updateProjectTime(gitUrl, timeSpent);
    }

    console.log("Temps passé envoyé à l'API avec succès !");
  } catch (error) {
    console.error("Erreur lors de l'envoi du temps passé à l'API :", error);
    statusBarItem.text = "❌ Erreur lors de l'envoi du temps passé à l'API";
  }
}

// Fonction pour formater le temps passé
function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);
  return `${hours}h ${remainingMinutes}min`;
}

// Fonction pour obtenir l'URL Git du workspace
async function getGitUrl(workspacePath) {
  if (!workspacePath) {
    return null;
  }
  try {
    const { exec } = require("child_process");
    return new Promise((resolve, reject) => {
      exec(
        "git config --get remote.origin.url",
        { cwd: workspacePath },
        (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        }
      );
    });
  } catch (error) {
    console.error("Erreur lors de l'obtention de l'URL Git :", error.message);
    return null;
  }
}

module.exports = {
  activate,
  deactivate,
};
