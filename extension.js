const vscode = require("vscode");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

let statusBarItem;
let startTime;
let currentWorkspace;
let timeSpentPerWorkspace = {};
let projects = [];
let activeProject = null;
let timerInterval = null;

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

// Fonction pour trouver ou créer un projet
async function findOrCreateProject(gitUrl, workspaceName) {
  if (!gitUrl) return null;

  let project = projects.find((p) => p.gitUrl === gitUrl);

  if (!project) {
    project = {
      gitUrl: gitUrl,
      name: workspaceName,
      timeSpent: 0,
      lastOpened: new Date().toISOString(),
    };
    projects.push(project);
    await saveProjects();
  }

  return project;
}

// Fonction pour mettre à jour le temps d'un projet
async function updateProjectTime(gitUrl, timeSpent) {
  try {
    // Formatter le temps en "X h Ymin"
    const hours = Math.floor(timeSpent / 60);
    const minutes = Math.floor(timeSpent % 60);
    const formattedTime = `${hours} h ${minutes}min`;

    // Mettre à jour le projet local
    const projectIndex = projects.findIndex((p) => p.gitUrl === gitUrl);
    if (projectIndex >= 0) {
      projects[projectIndex].timeSpent = timeSpent;
      projects[projectIndex].lastOpened = new Date().toISOString();
    } else {
      // Ajouter un nouveau projet
      projects.push({
        gitUrl: gitUrl,
        name: currentWorkspace,
        timeSpent: timeSpent,
        lastOpened: new Date().toISOString(),
      });
    }

    // Sauvegarder les projets
    await saveProjects();

    // Envoyer au portfolio
    await axios.post("http://localhost:3001/api/projects/update", {
      github: gitUrl,
      hoursSpent: formattedTime,
      lastUpdated: new Date().toISOString(),
    });

    console.log("Temps mis à jour dans le portfolio:", formattedTime);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du portfolio:", error);
  }
}

// Fonction pour mettre à jour le compteur en temps réel
function updateRealTimeCounter() {
  if (!activeProject) return;

  const now = new Date();
  const elapsedMinutes = Math.floor(
    (now.getTime() - startTime.getTime()) / 1000 / 60
  );
  const totalTime = activeProject.timeSpent + elapsedMinutes;

  // Format: "Session: 1h 23min | Total: 5h 45min"
  const sessionTime = formatTime(elapsedMinutes);
  const totalTimeFormatted = formatTime(totalTime);

  statusBarItem.text = `📁 ${currentWorkspace} | Session: ${sessionTime} | Total: ${totalTimeFormatted}`;
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

  // Initialiser le projet actif
  (async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders
      ? workspaceFolders[0].uri.fsPath
      : null;
    const gitUrl = await getGitUrl(workspacePath);

    if (gitUrl) {
      activeProject = await findOrCreateProject(gitUrl, currentWorkspace);
      updateRealTimeCounter();

      // Démarrer le compteur en temps réel
      timerInterval = setInterval(updateRealTimeCounter, 10000); // Mise à jour toutes les 10 secondes
    }
  })();

  // Listener pour détecter l'enregistrement d'un fichier
  vscode.workspace.onDidSaveTextDocument((document) => {
    const fileName = document.fileName;
    const workspaceName = vscode.workspace.name || "No Workspace";

    // Mise à jour du StatusBarItem lors de l'enregistrement
    if (!activeProject) {
      statusBarItem.text = `📁 ${workspaceName} | Fichier enregistré : ${fileName
        .split("/")
        .pop()}`;
    }
    console.log(
      `Fichier enregistré : ${fileName} dans l'espace : ${workspaceName}`
    );

    // Envoie des données à l'API après l'enregistrement
    sendStatusToAPI(workspaceName, fileName);
  });

  // Listener pour détecter le changement de dossier racine
  vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    const newWorkspace = vscode.workspace.name || "No Workspace";
    if (newWorkspace !== currentWorkspace) {
      // Sauvegarder le temps du projet actuel
      if (activeProject) {
        const endTime = new Date();
        const timeSpent = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // en minutes
        activeProject.timeSpent += timeSpent;
        await saveProjects();
        await updateProjectTime(activeProject.gitUrl, activeProject.timeSpent);
      }

      // Réinitialiser pour le nouveau workspace
      currentWorkspace = newWorkspace;
      startTime = new Date();

      // Initialiser le nouveau projet actif
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const workspacePath = workspaceFolders
        ? workspaceFolders[0].uri.fsPath
        : null;
      const gitUrl = await getGitUrl(workspacePath);

      if (gitUrl) {
        activeProject = await findOrCreateProject(gitUrl, currentWorkspace);
      } else {
        activeProject = null;
      }

      updateRealTimeCounter();
    }
  });

  console.log("Extension VS Code Status Sync activée !");
}

function deactivate() {
  // Arrêter le compteur en temps réel
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Sauvegarder le temps du projet actuel
  if (activeProject) {
    const endTime = new Date();
    const timeSpent = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // en minutes
    activeProject.timeSpent += timeSpent;
    saveProjects();
    updateProjectTime(activeProject.gitUrl, activeProject.timeSpent);
  }

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

    // Calculer le temps écoulé
    const now = new Date();
    const elapsedMinutes = Math.floor(
      (now.getTime() - startTime.getTime()) / 1000 / 60
    );
    const sessionTime = formatTime(elapsedMinutes);
    const totalTime = activeProject
      ? formatTime(activeProject.timeSpent + elapsedMinutes)
      : "0min";

    const statusData = {
      workspace,
      file,
      gitUrl,
      timestamp: new Date().toISOString(),
      sessionTime,
      totalTime, // Make sure this is sent
    };

    console.log("Sending status data:", statusData); // Debug log

    await axios.post("http://localhost:3001/status", statusData);

    console.log("Données envoyées à l'API avec succès !");
    statusBarItem.text = `📁 ${workspace} | Session: ${sessionTime}`;
  } catch (error) {
    console.error(
      "Erreur lors de l'envoi des données à l'API :",
      error.message
    );
    statusBarItem.text = "❌ Erreur lors de l'envoi des données à l'API";
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
