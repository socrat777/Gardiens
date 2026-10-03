# GARDIEN — GitHub + Render

## 1. GitHub depuis iPhone
1. Ouvrir GitHub et créer un dépôt public ou privé nommé `gardien`.
2. Ajouter tous les fichiers de ce dossier à la racine du dépôt.
3. Ne jamais téléverser `.env` ni une clé API.

## 2. Render
1. Créer un compte sur Render.
2. New → Web Service.
3. Connecter le dépôt GitHub `gardien`.
4. Les réglages sont déjà décrits dans `render.yaml`.
5. Lancer le déploiement.
6. Render fournit une URL `https://...onrender.com`.

## 3. Clé IA
Dans Render → Environment, ajouter `OPENAI_API_KEY` avec la clé secrète. Ne pas l'écrire dans le code.

## 4. Domaine personnalisé
Dans Render → Settings → Custom Domains, ajouter le domaine choisi. Le registrar donnera les enregistrements DNS à configurer.

## 5. Vérification
Ouvrir `/api/health` sur l'URL Render. Le serveur doit répondre avec un statut de santé.

## Important
Les indicateurs actuels de démonstration ne constituent pas des données scientifiques en temps réel. Avant un lancement public, remplacer ces données par des sources vérifiées et datées.
