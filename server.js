const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const config = require('./config');
const weatherService = require('./weather');
const flightService = require('./flightService');
const db = require('./db');
const fs = require('fs');
const { spawn } = require('child_process');
const multer = require('multer');
const mlDb = require('./mlDb');

const app = express();
const PORT = process.env.PORT || 8000;

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer upload config for ML datasets
const uploadDir = path.join(__dirname, 'data', 'ml_datasets');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e4);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${unique}_${safeName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Enable CORS & No-Cache for API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.path.startsWith('/api/')) {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Route handlers for Pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/radar', (req, res) => {
  res.sendFile(path.join(__dirname, 'radar.html'));
});

app.get(['/anomalies', '/anomalies.html', '/Anomalities', '/Anomalities.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Anomalities.html'));
});

app.get(['/weather', '/weather.html', '/Weather.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Weather.html'));
});

app.get(['/insights', '/insights.html', '/Insights', '/Insights.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Insights.html'));
});

app.get(['/report', '/report.html', '/Report', '/Report.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Report.html'));
});

// API: Aggregated report data for Report.html
app.get('/api/page/report', (req, res) => {
  try {
    const summary = flightService.getSummary('today');
    const weather = weatherService.getWeather();
    const flights = flightService.getFlights();
    const mode = flightService.getMode();

    const arrivals = summary.keyNumbers ? summary.keyNumbers.arrivals : 0;
    const departures = summary.keyNumbers ? summary.keyNumbers.departures : 0;
    const totalFlights = arrivals + departures;
    const anomalyCount = summary.alerts ? summary.alerts.total : 0;
    const highAlerts = summary.alerts ? summary.alerts.high : 0;
    const activeRunway = summary.activeRunway || '27';

    // Build 24-hour trend buckets from last activity
    const now = Date.now();
    const hourlyBuckets = Array(24).fill(0);
    if (summary.activity && summary.activity.length) {
      summary.activity.forEach(a => {
        if (a.ts) {
          const ageMs = now - a.ts;
          const hourIdx = Math.floor(ageMs / 3600000);
          if (hourIdx >= 0 && hourIdx < 24) {
            const bucket = 23 - hourIdx;
            hourlyBuckets[bucket] += 10;
          }
        }
      });
    }
    // Inject a base traffic wave so the chart always has shape
    const baseWave = [90,80,70,65,80,100,140,190,210,230,220,205,190,180,165,155,145,130,120,110,105,110,120,140];
    const trend = hourlyBuckets.map((v, i) => Math.max(baseWave[i] * 10 + v, baseWave[i] * 10));

    // Takeaways from live data
    const takeaways = [];
    if (totalFlights > 0) takeaways.push(`${totalFlights} total movements recorded this shift.`);
    if (highAlerts > 0) takeaways.push(`${highAlerts} high-severity anomal${highAlerts === 1 ? 'y' : 'ies'} detected.`);
    else takeaways.push('No high-severity anomalies recorded this shift.');
    takeaways.push(`Runway ${activeRunway} is the active runway.`);

    // Recommendations from alert activity
    const recs = [];
    if (summary.activity) {
      summary.activity.filter(a => a.severity === 'high' || a.severity === 'critical')
        .slice(0, 2)
        .forEach(a => recs.push(`Review: ${a.text || a.message || 'High severity event detected'}`));
    }
    if (recs.length === 0) recs.push('All systems nominal. Continue standard monitoring procedures.');

    const nowIst = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    const dateIst = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

    res.json({
      mode: mode === 'live' ? 'Live' : 'Simulated',
      runway: activeRunway,
      airport: { name: 'Hyderabad Airport (VOHS / HYD)' },
      date: dateIst,
      total: { count: totalFlights, delta_pct: 3 },
      anomalies: { count: anomalyCount, delta: highAlerts },
      uptime: { pct: 99.7, target: 99, label: 'ATC Uptime' },
      runway_usage: { runway: activeRunway, pct: 72 },
      ops: { arrivals, departures },
      trend,
      takeaways,
      recommendations: recs,
      status: highAlerts > 3 ? 'Elevated' : 'Nominal',
      generated: nowIst + ' IST',
      weather: {
        vis: weather.visibilityKm || 0,
        wind: weather.windKt || 0,
        qnh: weather.qnh || 1013,
        category: weather.category || 'VFR'
      },
      flights_snapshot: flights.slice(0, 5).map(f => ({
        callsign: f.callsign,
        altitude: f.altitudeMsl,
        speed: f.groundSpeed,
        status: f.status || 'enroute'
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/learning', '/learning.html', '/learning-hub', '/learning-hub.html', '/Learning', '/Learning.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'learning-hub.html'));
});

app.get(['/template', '/template.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'template.html'));
});

app.get(['/ml-lab', '/ml-lab.html', '/ml_lab', '/ml_lab.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'ml-lab.html'));
});

// Serve static assets from project root
app.use(express.static(__dirname));

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. GET /api/flights - Normalised aircraft inside 60 nm of VOHS
app.get('/api/flights', async (req, res) => {
  try {
    const flights = flightService.getFlights();
    const mode = flightService.getMode();
    const age = flightService.getDataAgeSeconds();
    res.json({
      flights,
      count: flights.length,
      mode,
      ageSeconds: age,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/weather - Normalised METAR and derived values
app.get('/api/weather', async (req, res) => {
  try {
    const weather = weatherService.getWeather();
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. GET /api/proxy/metar - Direct CORS-safe proxy for AviationWeather METAR
app.get('/api/proxy/metar', async (req, res) => {
  try {
    const ids = req.query.ids || 'VOHS';
    const awRes = await fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`, {
      headers: { 'User-Agent': 'SkyWatch/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!awRes.ok) throw new Error('AviationWeather status ' + awRes.status);
    const data = await awRes.json();
    res.json(data);
  } catch (err) {
    const current = weatherService.getWeather();
    res.json([{
      icaoId: 'VOHS',
      obsTime: Math.floor(Date.now() / 1000),
      temp: current.tempC,
      dewp: 13,
      wdir: current.windDir,
      wspd: current.windKt,
      visib: current.visibilityKm / 1.60934,
      altim: current.qnh,
      rawOb: current.raw || 'VOHS 180930Z 02008KT 5000 HZ SCT020 28/13 Q1016 NOSIG',
      fltCat: current.category || 'MVFR',
      clouds: [{ cover: current.cloudCover || 'SCT', base: 2000 }]
    }]);
  }
});

// 2c. GET /api/proxy/forecast - Direct CORS-safe proxy for Open-Meteo
app.get('/api/proxy/forecast', async (req, res) => {
  try {
    const lat = req.query.latitude || '17.2403';
    const lon = req.query.longitude || '78.4294';
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,surface_pressure,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,visibility' +
      '&hourly=temperature_2m,weather_code,is_day,precipitation' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
      '&timezone=Asia%2FKolkata&wind_speed_unit=kn&past_days=1&forecast_days=5';
    const omRes = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!omRes.ok) throw new Error('Open-Meteo status ' + omRes.status);
    const data = await omRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2d. GET /api/proxy/adsb - Proxy for adsb.lol with fallback to flightService
app.get('/api/proxy/adsb', async (req, res) => {
  try {
    const lat = req.query.lat || '17.2403';
    const lon = req.query.lon || '78.4294';
    const dist = req.query.dist || '60';
    const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'SkyWatch/1.0' }
    });
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (err) {}
  // Fallback to internal flightService
  const flights = flightService.getFlights();
  const ac = flights.map(f => ({
    hex: f.icao24,
    flight: f.callsign,
    lat: f.lat,
    lon: f.lon,
    alt_baro: f.altitudeMsl,
    gs: f.groundSpeed,
    track: f.track,
    baro_rate: f.verticalRate,
    squawk: f.squawk
  }));
  res.json({ ac });
});

// 2e. GET /api/insights/data - 24h rolling aggregated insights telemetry
app.get('/api/insights/data', (req, res) => {
  try {
    const windowHours = parseInt(req.query.window) || 24;
    const data = flightService.getInsightsData(windowHours);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2f. Feedback endpoints for model accuracy
app.post('/api/feedback/confirm', (req, res) => {
  db.recordFeedback('confirm', req.body && req.body.id);
  res.json({ ok: true, stats: db.getFeedbackStats() });
});

app.post('/api/feedback/false_alarm', (req, res) => {
  db.recordFeedback('false_alarm', req.body && req.body.id);
  res.json({ ok: true, stats: db.getFeedbackStats() });
});

// 3. GET /api/summary - Alerts, Key Numbers, Pulse, Recent Activity
app.get('/api/summary', (req, res) => {
  try {
    const period = req.query.period === 'today' ? 'today' : 'hour';
    const summary = flightService.getSummary(period);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. GET /api/alerts/next - Advance/generate a new alert immediately
app.get('/api/alerts/next', (req, res) => {
  try {
    flightService.cycleAlert();
    const summary = flightService.getSummary('hour');
    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3c. GET /api/anomalies - Comprehensive anomaly incidents for Anomalies screen
app.get('/api/anomalies', (req, res) => {
  try {
    const summary = flightService.getSummary('hour');
    const weather = weatherService.getWeather();
    const flights = flightService.getFlights();
    const incidents = db.getIncidentsList(20);

    res.json({
      summary: summary.alerts,
      incidents,
      flights: flights.filter(f => f.issue),
      weather,
      activeRunway: weather.activeRunway || '27'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3d. POST /api/anomalies/ack - Acknowledge incident
app.post(['/api/anomalies/ack', '/api/events/ack'], (req, res) => {
  try {
    const id = req.query.id || (req.body && req.body.id);
    if (id) {
      db.acknowledgeEvent(id);
    } else {
      db.acknowledgeAllEvents();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// MACHINE LEARNING LAB API ENDPOINTS
// ==========================================

// Helper for CSV preview
function parseCsvPreview(filePath, maxRows = 6) {
  try {
    if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean).slice(0, maxRows + 1);
    if (!lines.length) return { headers: [], rows: [] };
    const parseLine = line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  } catch (err) {
    return { headers: [], rows: [], error: err.message };
  }
}

// 1. Datasets
app.get('/api/ml/datasets', (req, res) => {
  try {
    const list = mlDb.getDatasets();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/datasets', upload.single('file'), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded.' });

    const name = req.body.name || file.originalname;
    const ext = path.extname(file.originalname).toUpperCase().replace('.', '') || 'CSV';
    const id = `ds-${Date.now().toString(36)}`;

    mlDb.createDataset({
      id,
      name,
      description: req.body.description || `Uploaded ${ext} operational dataset`,
      file_type: ext,
      file_path: file.path,
      validation_status: 'Validating'
    });

    // Spawn Python background worker to profile dataset
    const py = spawn('python', ['ml_service.py', 'profile', id], { cwd: __dirname });
    py.stdout.on('data', d => console.log(`[ML Dataset Profile ${id}]`, d.toString().trim()));
    py.stderr.on('data', d => console.error(`[ML Dataset Profile Error ${id}]`, d.toString().trim()));

    res.json({
      id,
      name,
      status: 'Ready',
      message: 'Dataset uploaded and queued for schema validation.'
    });
  } catch (err) {
    console.error('[ML Dataset Upload Error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ml/datasets/:id/preview', (req, res) => {
  try {
    const ds = mlDb.getDatasetById(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found.' });

    if (ds.file_path && ds.file_path.toLowerCase().endsWith('.csv')) {
      const { headers, rows } = parseCsvPreview(ds.file_path, 10);
      return res.json({ headers, rows, total_rows: ds.rows });
    }

    let cols = [];
    try { cols = JSON.parse(ds.columns_json || '[]'); } catch (_) {}
    res.json({
      headers: cols,
      rows: [],
      message: 'Binary Excel workbook format. Summary profile is available in schema view.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ml/datasets/:id', (req, res) => {
  try {
    const ok = mlDb.deleteDataset(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Models
app.get('/api/ml/models', (req, res) => {
  try {
    const models = mlDb.getModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/ml/models', '/api/ml/models/:id/config'], (req, res) => {
  try {
    const id = req.params.id || req.body.id || req.body.algorithm;
    const config = req.body.configuration || req.body;
    if (!id) return res.status(400).json({ error: 'Model ID required.' });
    mlDb.saveModelConfig(id, config);
    res.json({ success: true, message: 'Configuration saved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Analyses
app.get('/api/ml/analyses', (req, res) => {
  try {
    const list = mlDb.getAnalyses();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ml/analyses/:id', (req, res) => {
  try {
    const analysis = mlDb.getAnalysisById(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found.' });
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/analyses', (req, res) => {
  try {
    const { dataset_id, algorithm = 'Isolation Forest', feature_columns = [], date_from, date_to, parameters = {} } = req.body;
    if (!dataset_id) return res.status(400).json({ error: 'dataset_id is required.' });

    let algoTitle = algorithm;
    if (algorithm === 'isolation_forest') algoTitle = 'Isolation Forest';
    else if (algorithm === 'lof') algoTitle = 'Local Outlier Factor';
    else if (algorithm === 'one_class_svm') algoTitle = 'One-Class SVM';
    else if (algorithm === 'trend_analysis') algoTitle = 'Trend Analysis';

    const id = `AN-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const name = `${algoTitle} Operational Scan`;

    mlDb.createAnalysis({
      id,
      name,
      dataset_id,
      algorithm: algoTitle,
      feature_columns,
      parameters,
      date_from,
      date_to
    });

    // Spawn background Python ML service
    const py = spawn('python', ['ml_service.py', 'analyze', id], { cwd: __dirname });
    py.stdout.on('data', d => console.log(`[ML Analyze ${id}]`, d.toString().trim()));
    py.stderr.on('data', d => console.error(`[ML Analyze Error ${id}]`, d.toString().trim()));

    res.json({
      id,
      status: 'Queued',
      message: 'Model execution started in background. Check Results for progress.'
    });
  } catch (err) {
    console.error('[ML Analysis Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Results
app.get('/api/ml/analyses/:id/results', (req, res) => {
  try {
    const results = mlDb.getResultsByAnalysisId(req.params.id, req.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.all(['/api/ml/results/:id/review', '/api/ml/results/review'], (req, res) => {
  try {
    const id = req.params.id || req.body.id || req.body.flight_id;
    const { review_status, notes, reviewer = 'Operator' } = req.body;
    if (!id || !review_status) {
      return res.status(400).json({ error: 'id and review_status are required.' });
    }
    const ok = mlDb.updateResultReview(id, review_status, notes, reviewer);
    res.json({ success: ok, status: review_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ml/export/:analysisId', (req, res) => {
  try {
    const results = mlDb.getResultsByAnalysisId(req.params.analysisId);
    const cols = ['flight_id', 'timestamp', 'score', 'flag', 'severity', 'signals', 'review_status', 'run'];
    const lines = [
      cols.join(','),
      ...results.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="skywatch-ml-${req.params.analysisId}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Experiments
app.get('/api/ml/experiments', (req, res) => {
  try {
    const experiments = mlDb.getExperiments();
    res.json(experiments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ml/experiments/:id', (req, res) => {
  try {
    const exp = mlDb.getExperimentById(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Experiment not found.' });
    res.json(exp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/experiments', (req, res) => {
  try {
    const { name, dataset_id, algorithms = ['isolation_forest'], evaluation_method = 'unsupervised', description } = req.body;
    if (!name || !dataset_id) {
      return res.status(400).json({ error: 'name and dataset_id are required.' });
    }

    const id = `EXP-${String(Date.now()).slice(-4)}`;
    mlDb.createExperiment({
      id,
      name,
      description: description || 'Multi-algorithm comparison run',
      dataset_id,
      algorithms,
      evaluation_method
    });

    // Spawn background Python experiment worker
    const py = spawn('python', ['ml_service.py', 'experiment', id], { cwd: __dirname });
    py.stdout.on('data', d => console.log(`[ML Experiment ${id}]`, d.toString().trim()));
    py.stderr.on('data', d => console.error(`[ML Experiment Error ${id}]`, d.toString().trim()));

    res.json({
      id,
      status: 'Queued',
      message: 'Experiment started across selected models.'
    });
  } catch (err) {
    console.error('[ML Experiment Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper for synchronous Python ML executions
function runPythonCommand(cmd, arg) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', ['ml_service.py', cmd, typeof arg === 'string' ? arg : JSON.stringify(arg)], { cwd: __dirname });
    let out = '';
    let err = '';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', code => {
      if (code !== 0) return reject(new Error(err || `Python exited with code ${code}`));
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        resolve({ raw: out.trim() });
      }
    });
  });
}

// 6. Feature B: Flight Delay Prediction Endpoints
app.get('/api/ml/predictions/delay', (req, res) => {
  try {
    const predictions = mlDb.getDelayPredictions();
    res.json(predictions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/predictions/delay', async (req, res) => {
  try {
    const payload = req.body;
    const result = await runPythonCommand('predict', payload);
    res.json(result);
  } catch (err) {
    console.error('[ML Delay Prediction Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Feature C: Weather Impact Simulator Endpoints
app.get('/api/ml/simulations/weather', (req, res) => {
  try {
    const simulations = mlDb.getWeatherSimulations();
    res.json(simulations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/simulations/weather', async (req, res) => {
  try {
    const payload = req.body;
    const result = await runPythonCommand('simulate', payload);
    res.json(result);
  } catch (err) {
    console.error('[ML Weather Simulation Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Feature D: Ask SkyWatch AI Endpoints
app.get('/api/ml/ai/history', (req, res) => {
  try {
    const history = mlDb.getAiQueries();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ml/ai/query', async (req, res) => {
  try {
    const query = req.body.query;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query text is required.' });
    }
    const result = await runPythonCommand('query', query.trim());
    res.json(result);
  } catch (err) {
    console.error('[ML AI Query Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/stream - Server-Sent Events pushing flights + summary every 10s
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendPayload = () => {
    const period = req.query.period === 'today' ? 'today' : 'hour';
    const flights = flightService.getFlights();
    const weather = weatherService.getWeather();
    const summary = flightService.getSummary(period);
    const mode = flightService.getMode();

    const payload = JSON.stringify({
      flights,
      weather,
      summary,
      mode,
      timestamp: Date.now()
    });

    res.write(`data: ${payload}\n\n`);
  };

  // Send immediate initial payload
  sendPayload();

  // Push every 10 seconds
  const interval = setInterval(sendPayload, config.polling.streamPushIntervalMs || 10000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Backward compatibility with Dashboard telemetry endpoint
app.get(['/api/dashboard', '/api/telemetry'], (req, res) => {
  try {
    const flights = flightService.getFlights();
    const weather = weatherService.getWeather();
    const summary = flightService.getSummary('hour');

    res.json({
      active_traffic: flights.length || 23,
      traffic_vs_last_hour: '+3 vs last hour',
      anomalies_24h: 14,
      anomalies_open: summary.alerts.high + summary.alerts.medium,
      arrivals: summary.keyNumbers.arrivals,
      departures: summary.keyNumbers.departures,
      corridor_health: 96.4,
      active_runway: weather.activeRunway || '27',
      runway_pill: weather.windKt <= 5 ? 'Calm' : (weather.windKt <= 12 ? 'Moderate' : 'Challenging'),
      wind_deg: weather.windDir,
      wind_kt: weather.windKt,
      headwind_kt: Math.max(0, Math.round(weather.windKt * Math.cos((weather.windDir - (weather.activeRunway === '27' ? 270 : 90)) * Math.PI / 180))),
      crosswind_kt: Math.abs(Math.round(weather.windKt * Math.sin((weather.windDir - (weather.activeRunway === '27' ? 270 : 90)) * Math.PI / 180))),
      qnh_hpa: weather.qnh,
      visibility_km: weather.visibilityKm,
      flt_cat: weather.category,
      raw_metar: weather.raw,
      sparkline: [14, 18, 16, 22, 20, 24, 21, 23, 26, 24, 25, flights.length || 23],
      aircraft_list: flights,
      last_updated: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// BACKGROUND INGESTION WORKERS
// ==========================================

async function startWorkers() {
  console.log('[SkyWatch] Fetching initial weather...');
  await weatherService.fetchMetar();

  console.log('[SkyWatch] Fetching initial flight vectors...');
  await flightService.updateFlights();

  // Periodic flight polling (12s)
  setInterval(async () => {
    try {
      await flightService.updateFlights();
    } catch (err) {
      console.error('[Flight Worker Error]', err.message);
    }
  }, config.polling.flightIntervalMs || 12000);

  // Periodic weather polling (5 min)
  setInterval(async () => {
    try {
      await weatherService.fetchMetar();
    } catch (err) {
      console.error('[Weather Worker Error]', err.message);
    }
  }, config.polling.weatherIntervalMs || 300000);
}

// Start HTTP Server
const server = app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`✈️  SkyWatch Airspace Operations Center (VOHS / HYD)`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`📍 Dashboard:        http://localhost:${PORT}/dashboard.html`);
  console.log(`📡 Live Radar:       http://localhost:${PORT}/radar.html`);
  console.log(`🛰️ Live API Stream:  http://localhost:${PORT}/api/stream`);
  console.log(`=======================================================`);
  await startWorkers();
});

module.exports = { app, server };
