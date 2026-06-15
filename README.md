# Forensic Minimal — Plateforme SOC / DFIR

Plateforme forensic et SOC **clé en main**, pensée pour le lab, la formation et les équipes CERT/DFIR. Elle regroupe ingestion, SIEM, threat intelligence, gestion d’incidents, timelines, hunting et collecte endpoint derrière un point d’entrée HTTPS unique.

**Public cible :** analystes SOC, ingénieurs DFIR, formateurs, lab interne.

---

## Overview

Forensic Minimal déploie une stack Docker orchestrée par un seul script :

```bash
git clone git@github.com:waraperkin/forensic-minimal.git
cd forensic-minimal
./forensic.sh -full-start
```

À l’issue d’un `-full-start` réussi :

- **11/11 services** remontés dans `/api/health/global`
- **TLS**, secrets et réseaux créés automatiquement (bootstrap machine vierge)
- **OpenSearch Dashboards** : dashboards SIEM/TI/Observability importés
- **700+ règles** de détection et monitors d’alerting
- **Portails CERT/IT** opérationnels pour l’ingestion et les pivots cross-tool

Documentation détaillée : répertoire [`docs/`](docs/) (architecture portails, HELK, Velociraptor, QA).

---

## Architecture

### Composants

| Couche | Services |
|--------|----------|
| **Point d’entrée** | Nginx (HTTPS), portails CERT + IT |
| **SIEM & recherche** | OpenSearch, OpenSearch Dashboards, Logstash, Filebeat |
| **Stockage** | MinIO (evidences, artefacts) |
| **Forensic timeline** | Timesketch (+ worker d’ingestion) |
| **Threat Intelligence** | OpenCTI, MISP, connecteurs TI |
| **Incident Response** | TheHive, Cortex |
| **Observabilité** | Grafana, Prometheus, Loki, Tempo |
| **Hunting & DFIR** | HELK (sidecar ES/Kibana/Logstash), Velociraptor |
| **Infrastructure** | PostgreSQL, Redis, RabbitMQ, Cassandra |

### Flux de données (schéma logique)

```
[Evidences / logs / agents]
        │
        ▼
  Portails CERT/IT ──► MinIO ──► ingest-worker ──► OpenSearch
        │                      │                        │
        │                      └──► Timesketch ◄──────┘
        │
        ├──► OpenCTI / MISP (IOC, enrichissement TI)
        ├──► TheHive / Cortex (cas IR, analyseurs)
        ├──► HELK (hunting, Sigma)
        └──► Velociraptor (collecte DFIR)

[Nginx HTTPS] ──► Dashboards OSD / Grafana / CTI / MISP / …
                      │
                      └──► Pivots cross-tool (host, IOC, case, timeline)
```

Les bridges `helk-bridge` et `velociraptor-bridge` synchronisent les sidecars avec la stack principale et les portails.

---

## Prerequisites

| Exigence | Recommandation |
|----------|----------------|
| **OS** | Debian 12 (bookworm) ou Ubuntu 22.04+ |
| **Docker** | Engine récent + **Docker Compose v2** (`docker compose`) |
| **Utilisateur** | Membre du groupe `docker` (ou root) |
| **CPU** | 8 cœurs minimum, **16 cœurs** recommandés |
| **RAM** | 8 Go minimum, **16–32 Go** recommandés |
| **Disque** | **100 Go+** libres (images, indices OpenSearch, evidences) |
| **Réseau** | Accès Internet pour pull d’images (premier démarrage) |

Packages utilisés par l’orchestrateur : `curl`, `openssl`, `jq`, `python3`, `git`.

### Ports critiques

Sur l’hôte, les ports suivants doivent être libres (ou détenus par cette stack) :

| Port | Usage |
|------|--------|
| **80 / 443** | Nginx (HTTP → HTTPS, services) |
| **9200** | OpenSearch (API locale) |
| **5601** | OpenSearch Dashboards (direct) |
| **5000** | Timesketch (direct, optionnel) |
| **9000 / 9001** | MinIO API / console |

> **Note :** ne pas lancer deux clones `forensic-minimal` sur la même machine sans arrêter l’autre stack (`./forensic.sh full-stop`). Les noms de conteneurs (`forensic-*`) sont fixes.

---

## Installation

### 1. Cloner le dépôt

```bash
git clone git@github.com:waraperkin/forensic-minimal.git
cd forensic-minimal
```

### 2. Lancer l’orchestrateur complet

```bash
./forensic.sh -full-start
```

Alias équivalents : `./forensic.sh full-start`, `./forensic.sh full`, `./forensic.sh rebuild`.

**Durée estimée :** 1 à 2 heures au premier démarrage (pull d’images, build, activation SIEM/TI, import dashboards).

### Ce que fait le bootstrap (Phase 0)

Sur une machine vierge, **aucune configuration manuelle** n’est requise :

1. Copie `.env.example` → `.env` et génération des **secrets** (MinIO, MySQL/MISP, OpenCTI, portails, Grafana, TheHive, Cortex, etc.)
2. Génération **TLS** : CA interne, certificat serveur, certs portails / HELK / Velociraptor
3. Création des dossiers persistants et validation Nginx
4. Génération `timesketch.conf`, patch `config.json` portails (`soc_base_url`)
5. Création des réseaux Docker externes `helk_net` (172.30.0.0/24) et `velociraptor_net` (172.31.0.0/24)

L’IP publique de la machine est détectée automatiquement (`hostname -I`) et injectée dans TLS et les portails.

### Options utiles

```bash
# Ignorer les tests Playwright (démarrage plus rapide)
FP_ORCH_SKIP_PLAYWRIGHT=1 ./forensic.sh -full-start

# Seuil disque critique plus haut si l’hôte est presque plein
FP_DISK_CRITICAL_PCT=96 ./forensic.sh -full-start
```

---

## Access URLs

Remplacez `<IP>` par l’adresse de la machine (`hostname -I | awk '{print $1}'`).

Tous les services passent par **HTTPS** (certificat auto-signé — accepter l’exception navigateur ou importer la CA depuis `nginx/certs/ca/ca.crt`).

| Service | URL | Authentification |
|---------|-----|------------------|
| **Portail CERT** | `https://<IP>/` | Compte portail (bootstrap : `admin` / voir note ci-dessous) |
| **Portail IT** | `https://<IP>/it/` | Token de dépôt généré par le CERT |
| **Santé globale** | `https://<IP>/api/health/global` | Aucune (JSON) |
| **OpenSearch Dashboards** | `https://<IP>/dashboards/` | Session portail / basic |
| **Grafana** | `https://<IP>/grafana/` | Admin Grafana (mot de passe dans `.env`) |
| **Timesketch** | `https://<IP>/timesketch/` | Compte Timesketch (`.env`) |
| **OpenCTI** | `https://<IP>/cti/` | Admin OpenCTI (`.env`) |
| **MISP** | `https://<IP>/misp/` | Compte MISP |
| **TheHive** | `https://<IP>/thehive/` | Compte TheHive |
| **Cortex** | `https://<IP>/cortex/` | Compte Cortex |
| **MinIO** | `https://<IP>/minio/` | Credentials MinIO (`.env`) |
| **HELK Kibana** | `https://<IP>/helk/kibana/` | Kibana HELK |
| **Velociraptor** | `https://<IP>/velociraptor/` | Admin VR |

**Timesketch direct (sans Nginx) :** `http://<IP>:5000/`

**Identifiants portail CERT (premier boot) :** si aucun utilisateur n’existe encore, le compte bootstrap est `admin` avec le mot de passe par défaut `F0r3ns1c_Portal_2024!` (surchargeable via `PORTAL_ADMIN_USER` / `PORTAL_ADMIN_PASSWORD`). Les autres secrets sont dans `.env` — **ne jamais committer ce fichier**.

---

## Health & Validation

### Vérification rapide

```bash
# Santé agrégée (11 services)
curl -sk https://<IP>/api/health/global | jq .

# Commandes intégrées
./forensic.sh check-health
./forensic.sh status
```

Réponse attendue de `/api/health/global` : `summary.ok` = 11, `summary.down` = 0.

### Logs principaux

| Fichier | Contenu |
|---------|---------|
| `logs/forensic_start.log` | Démarrage stack Docker |
| `logs/forensic_install.log` | Bootstrap, packages, `.env` |
| `logs/forensic_network.log` | Réseaux Docker, migration subnet |
| `logs/opensearch_dashboards_import.log` | Import dashboards OSD |
| `logs/misp-init.log` | Initialisation MISP |
| `logs/soc-autonomous.log` | Module SOC autonome |

### Commandes de cycle de vie

| Commande | Description |
|----------|-------------|
| `./forensic.sh -full-start` | Installation + build + activation complète |
| `./forensic.sh start` | Démarrage rapide (sans rebuild complet) |
| `./forensic.sh full-stop` | Arrêt de toute la stack |
| `./forensic.sh full-restart` | Redémarrage |
| `./forensic.sh tls` | Régénération / reload certificats |
| `./forensic.sh logs [service]` | Logs Docker |

---

## Usage

### Ingestion d’evidences

1. **Analyste CERT** : connexion au portail → génération d’un **token de dépôt** (`POST /api/tokens/generate`)
2. **Équipe IT** : `https://<IP>/it/?token=…` → upload fichiers
3. Le **ingest-worker** traite les fichiers (MinIO → OpenSearch, Timesketch, enrichissement TI)

Suivi : onglets Ingest / Operations du portail CERT, dashboards `fp-opensearch-overview`, `fp-observability-pipeline`.

### Threat Intelligence

- **OpenCTI** : hub CTI, connecteurs (MITRE, CVE, URLhaus, etc.)
- **MISP** : partage et corrélation IOC
- Sync vers OpenSearch : indices `forensic-ti-*`, dashboards `fp-ti-overview`, `fp-ioc-matches`
- Règles : 700+ monitors `FP-DET-*` dans OpenSearch Alerting

### Pivot cross-tool

Depuis le **portail CERT** : liens vers HELK, Velociraptor, OpenCTI, Timesketch, dashboards OSD. Les saved searches et drill-downs FP (`fp-drill-*`, `fp-pivot-*`) permettent de passer d’une vue agrégée à Discover (events, logs, IOC, MITRE).

### Hunting & DFIR

- **HELK** : Kibana hunting, règles Sigma, ingestion lab
- **Velociraptor** : collecte endpoint, export vers la plateforme via bridge

Scripts de setup sidecar : `scripts/helk_velociraptor_master_setup.sh`

---

## Tests

### Tests intégrés au full-start

L’orchestrateur exécute notamment :

- `scripts/ui_campaign_verify.py` — campagne UI / endpoints
- Vérification SIEM : `scripts/opensearch_siem_full_verify.py`
- Tests Playwright (sauf si `FP_ORCH_SKIP_PLAYWRIGHT=1`)

### Playwright (manuel)

```bash
cd tests
npm install
npx playwright install chromium
BASE_URL=https://<IP> npm test
```

Projets disponibles : `ui`, `playwright`, `ui-integration` (voir `tests/package.json`).

### Scripts de validation ciblés

```bash
python3 scripts/global_health_dashboard_verify.py
python3 scripts/helk_velociraptor_master_verify.py
python3 scripts/opensearch_siem_full_verify.py
./forensic.sh ui-campaign
```

---

## Limitations & notes

| Sujet | Détail |
|-------|--------|
| **Durée** | Le premier `-full-start` est long (build + activation SIEM/TI + 700 règles). Prévoir 1–2 h. |
| **Ressources** | Machine dédiée fortement recommandée ; éviter les VMs sous-dimensionnées (< 8 Go RAM). |
| **Production Internet** | Certificats auto-signés, secrets générés localement — **ne pas exposer tel quel sur Internet** sans hardening (WAF, certificats publics, rotation secrets, sauvegardes). |
| **Multi-instance** | Un seul déploiement par hôte conseillé (noms de conteneurs fixes, subnets Docker). |
| **Disque** | OpenSearch et MinIO consomment de l’espace rapidement ; surveiller `df` et les logs. |
| **MISP / OpenCTI** | Premier démarrage : 2–5 min de stabilisation (normal). |

### Dépannage rapide

| Symptôme | Action |
|----------|--------|
| Certificat navigateur refusé | Accepter l’exception ou `./forensic.sh tls` |
| OpenSearch cluster red | `./forensic.sh fix-opensearch` |
| Port déjà utilisé | `./forensic.sh full-stop` sur l’autre stack, ou libérer le port |
| Import OSD incomplet | Relancer `./forensic.sh opensearch-dashboards` ou `bash scripts/opensearch_dashboards_import_fp.sh` |

---

## Structure du dépôt

```
forensic-minimal/
├── forensic.sh              # Orchestrateur principal
├── docker-compose.yml       # Stack Docker
├── scripts/                 # Bootstrap, activation SIEM/TI, bridges
├── config/nginx/            # Reverse proxy HTTPS
├── portal-cert/ portal-it/  # Portails opérationnels
├── dashboards/              # Saved objects OpenSearch Dashboards
├── helk/ velociraptor/      # Sidecars hunting & DFIR
├── tests/                   # Playwright
└── docs/                    # Documentation détaillée
```

---

## License & credits

- Projet **forensic-minimal** — plateforme CYBERCORP / lab SOC.
- Composants tiers sous leurs licences respectives (OpenSearch, Grafana, OpenCTI, MISP, TheHive, Timesketch, Velociraptor, HELK, Sigma, etc.).
- Règles Sigma HELK : voir `helk/sigma/LICENSE`.

Pour la documentation approfondie : [`docs/FORENSIC-MINIMAL.md`](docs/FORENSIC-MINIMAL.md), [`docs/PORTAL/OVERVIEW.md`](docs/PORTAL/OVERVIEW.md).
