# GARDIEN — version prête pour mise en ligne

GARDIEN est une application web d'analyse et de simulation conçue pour aider les humains à comparer des solutions au bénéfice de l'humanité et de la Terre.

## Démarrage local

Prérequis : Node.js 20+.

```bash
npm start
```

Ouvrir : http://localhost:3000

## Configuration IA

Copier `.env.example` vers `.env`, puis définir côté serveur :

```text
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

La clé API ne doit jamais être placée dans `public/` ni dans le navigateur.

Sans configuration IA, `/api/ask` fonctionne en mode démonstration.

## API

- `GET /api/health` — état du service
- `POST /api/evaluate` — évaluation multi-critères
- `POST /api/ask` — question à GARDIEN

## Sécurité intégrée

- clé IA côté serveur uniquement ;
- limite de taille des requêtes ;
- limitation simple du débit ;
- en-têtes de sécurité HTTP ;
- contrôle des chemins de fichiers ;
- aucune action externe automatique ;
- contrôle humain requis dans les résultats.

## Mise en production

Déployer ce dossier sur un hébergeur Node.js compatible, définir `PORT` si l'hébergeur le demande, puis configurer `OPENAI_API_KEY` et `OPENAI_MODEL` comme variables secrètes.

Ensuite, connecter un nom de domaine au service et activer HTTPS.

## Important

Les indicateurs actuellement affichés dans l'interface sont des données de démonstration. Avant une utilisation réelle, chaque donnée doit comporter au minimum : source, date, territoire, unité, méthode, incertitude et historique.
