# ✈️ SkyWatch — Airspace Operations Center (VOHS / HYD)

> Real-Time Flight Anomaly Radar for Rajiv Gandhi International Airport, Hyderabad (ICAO: `VOHS`, IATA: `HYD`).

---

## 🧭 Overview

SkyWatch is an aviation radar and anomaly intelligence platform tracking aircraft within a **60 nautical mile radius** of Hyderabad's Rajiv Gandhi International Airport. It continuously ingests live ADS-B state vectors, correlates them with official NOAA METAR weather reports, and flags unusual aeronautical behaviors in real time.

### 📍 Airport Reference & Aviation Physics
* **Coordinates:** `17.2403°N, 78.4294°E`
* **Field Elevation:** **2,024 ft MSL** (Ground level reference; all drop and glide slope logic calculates **Height Above Airport / AGL** = `baro_altitude - 2,024 ft`).
* **Runways:**
  * `09R/27L`: 4,260 m × 60 m (Heading: 091° / 271°)
  * `09L/27R`: 3,707 m × 45 m (Heading: 091° / 271°)
* **Active Runway Rule:** Wind direction 180°–359° activates **RWY 27**; otherwise **RWY 09**.

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (Optional - fallback works out of the box)
cp .env.example .env

# 3. Run unit test suite
npm test

# 4. Start the live server
npm start
```

Open your browser to:
* **Dashboard (Operations Hub):** [http://localhost:8000/dashboard.html](http://localhost:8000/dashboard.html)
* **Live Radar (Center Stage):** [http://localhost:8000/radar.html](http://localhost:8000/radar.html)

---

## 📡 Live Data Architecture & APIs

| Service | Endpoint / Method | Role |
| :--- | :--- | :--- |
| **OpenSky Network** | `https://opensky-network.org/api/states/all` (OAuth2 client-credentials) | Primary live ADS-B state vectors in VOHS bounding box |
| **airplanes.live / adsb.lol** | `https://api.adsb.lol/v2/point/17.2403/78.4294/60` | Automatic fallback if OpenSky is rate-limited or unavailable |
| **Aviation Weather (NOAA)** | `https://aviationweather.gov/api/data/metar?ids=VOHS&format=json` | Live METAR, QNH, wind components, flight category |

### REST & Stream Endpoints
* `GET /api/flights` — Normalised aircraft within 60 nm of VOHS (flagged flights sorted first).
* `GET /api/weather` — Normalised METAR, wind vectors, runway assignment, and observation age.
* `GET /api/summary?period=hour|today` — Alert counts (high, medium, low, resolved), key numbers, disruption pulse, and activity feed.
* `GET /api/stream` — Real-time Server-Sent Events (SSE) pushing updates every 10 seconds.

---

## 🛡️ Anomaly Detection Rules

1. **Emergency Squawk (`high`)**: Transponder code set to `7500` (hijack), `7600` (radio failure), or `7700` (general emergency).
2. **Altitude Drop (`high`)**: Vertical descent rate $\le -4,000\text{ fpm}$ while below $5,000\text{ ft AGL}$ on consecutive readings outside standard approach wedges.
3. **Holding Pattern (`medium`)**: Cumulative heading turn $\ge 360^\circ$ within 6 minutes while outside final approach ($> 12\text{ nm}$).
4. **Go-Around (`medium`)**: Aircraft descending below $2,000\text{ ft AGL}$ within $10\text{ nm}$ of runway that initiates a climb $> +500\text{ fpm}$.
5. **Squawk Change (`low`)**: Discrete transponder code change during transit.
6. **Signal Lost (`low`)**: Aircraft below $10,000\text{ ft AGL}$ vanishing for $> 60\text{ s}$.

---

## 📊 Disruption Pulse Formula

The Disruption Pulse is calculated on a 0–100 scale:

$$\text{Pulse} = 0.35 \times \text{AnomalyRate} + 0.25 \times \text{HoldingShare} + 0.25 \times \text{WeatherSeverity} + 0.15 \times \text{TrafficDensity}$$

* **AnomalyRate:** Percent of active flights with detected anomalies.
* **HoldingShare:** Percent of active flights in a holding pattern.
* **WeatherSeverity:** `VFR = 0`, `MVFR = 40`, `IFR = 70`, `LIFR = 100`.
* **TrafficDensity:** Active flights vs. baseline 7-day median.
* **Level Mapping:** `< 25` Low · `< 50` Moderate · `< 75` Elevated · $\ge 75$ Severe.

---

## 🗄️ SQLite Persistence

Uses Node.js native `node:sqlite`:
* **`movements` Table:** Tracks arrivals and departures de-duplicated by ICAO24 per day (reset at 00:00 IST).
* **`events` Table:** Logs all flagged anomalies with timestamps, severity, and resolution lifecycle.

---

## 🎨 UI & Layout Fidelity

The Radar and Learning Hub pages follow the approved, frozen specification designed at `1456 × 819` (auto-scaling to any display via `--u` proportional units):
* Pure black background (`#000000`) with glass cards (`#10151b` → `#0a0d11` → `#07090c`).
* Restricted colour system: Sky blue (`#179ffc` / `#35b3ff`), white text, soft gray (`#dfe5ec`), muted gray (`#9aa5b4`).
* Amber (`#f6a716`) reserved exclusively for warnings and did-you-know lightbulb icons.
* Green (`#12e86a` / `#1fe05d`) for Live indicator status.

---

## 📚 Learning Hub & Dynamic Subpages (`template.html`)

The Learning Hub provides a complete educational curriculum and operational reference for air traffic controllers, pilots, and operations personnel. All subpages are powered by a single reusable, high-fidelity template (`template.html`) that dynamically renders data from editable JSON stores:

### 🔗 Navigation & URLs
* **Learning Hub Home:** [http://localhost:8000/learning-hub.html](http://localhost:8000/learning-hub.html)
* **Glossary:** [http://localhost:8000/template.html?page=glossary](http://localhost:8000/template.html?page=glossary)
  * Supports deep-linking directly to any term: `?page=glossary&term=Squawk%207700` or `?page=glossary&term=QNH`
  * Features live search, category chips, A–Z letter filter, rich detail panel with thresholds table, related terms navigation, and progress tracking.
* **Interactive Tutorials:** [http://localhost:8000/template.html?page=tutorials](http://localhost:8000/template.html?page=tutorials)
  * Self-paced guided walkthroughs with step-by-step radar telemetry simulation cards and completion markers.
* **Controller Best Practices:** [http://localhost:8000/template.html?page=best-practices](http://localhost:8000/template.html?page=best-practices)
  * Actionable ICAO Doc 4444 and DGCA CAR checklists, regulatory rationales, and real incident case studies.
* **Knowledge Base / FAQs:** [http://localhost:8000/template.html?page=faqs](http://localhost:8000/template.html?page=faqs)
  * Expandable accordion answers with bulleted breakdowns and direct cross-references to the glossary.
* **Topic Deep Dives:** [http://localhost:8000/template.html?page=topics](http://localhost:8000/template.html?page=topics)
  * Explore by domain: `?page=topics&topic=anomalies`, `weather-terms`, `runway-airspace`, `metrics`, `alerts`, `system`.
* **Machine Learning Lab:** [http://localhost:8000/template.html?page=ml-lab](http://localhost:8000/template.html?page=ml-lab)
  * Modular workbench container with telemetry source selection, model parameter explainers (Isolation Forest, LOF, One-Class SVM, DBSCAN, Z-Score), and scatter canvas placeholder ready for scikit-learn model execution.

### 📝 Where & How to Edit Knowledge Content

All content is fully decoupled from the markup and stored in human-readable JSON files in `content/`:

| File | Content Type | Primary Fields |
| :--- | :--- | :--- |
| `content/glossary.json` | 24+ Aviation Terms | `id`, `term`, `title`, `category`, `severity`, `shortDef`, `fullDef`, `operationalContext`, `keyParameters`, `relatedTerms` |
| `content/tutorials.json` | Step-by-Step Walkthroughs | `id`, `title`, `category`, `level`, `duration`, `summary`, `steps` (`stepNumber`, `title`, `body`, `callout`, `visual`) |
| `content/best-practices.json` | SOP Checklists | `id`, `title`, `category`, `priority`, `summary`, `checklist`, `rationale`, `incidentCase` |
| `content/faqs.json` | Common Q&A | `id`, `category`, `question`, `shortAnswer`, `detailedAnswer`, `relatedTerm` |
| `content/topics.json` | Domain Knowledge | `id`, `title`, `icon`, `summary`, `overview`, `coreConcepts`, `featuredGlossaryTerms`, `featuredTutorials`, `keyRules` |

To add or modify any concept, simply edit the corresponding JSON file. The change takes effect immediately on page refresh without rebuilding or restarting the frontend.

### ⚙️ Running the Backend Daemons

```bash
# Start the Node.js Express API & static server (port 8000)
node server.js

# (Optional) Start the live ADS-B background ingestion collector
python collect_starter.py
```

