const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'skywatch.sqlite');
const db = new DatabaseSync(dbPath);

const mlDb = {
  // Datasets
  getDatasets() {
    try {
      const stmt = db.prepare(`
        SELECT id, name, description, file_type as kind, file_path, row_count as rows,
               column_count as columns, missing_count as missing, validation_status as status,
               columns_json, schema_json, created_at,
               strftime('%Y-%m-%d', created_at) as uploaded_at
        FROM ml_datasets
        ORDER BY created_at DESC
      `);
      return stmt.all();
    } catch (err) {
      console.error('[ML DB] getDatasets error:', err);
      return [];
    }
  },

  getDatasetById(id) {
    try {
      const stmt = db.prepare(`
        SELECT id, name, description, file_type as kind, file_path, row_count as rows,
               column_count as columns, missing_count as missing, validation_status as status,
               columns_json, schema_json, created_at
        FROM ml_datasets
        WHERE id = ?
      `);
      return stmt.get(id);
    } catch (err) {
      console.error('[ML DB] getDatasetById error:', err);
      return null;
    }
  },

  createDataset({ id, name, description, file_type, file_path, row_count = 0, column_count = 0, missing_count = 0, columns_json = '[]', schema_json = '{}', validation_status = 'Validating' }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO ml_datasets (
          id, name, description, file_type, file_path, row_count, column_count, missing_count, columns_json, schema_json, validation_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, name, description || '', file_type || 'CSV', file_path, row_count, column_count, missing_count, columns_json, schema_json, validation_status);
      return this.getDatasetById(id);
    } catch (err) {
      console.error('[ML DB] createDataset error:', err);
      throw err;
    }
  },

  deleteDataset(id) {
    try {
      const ds = this.getDatasetById(id);
      if (ds && ds.file_path && fs.existsSync(ds.file_path)) {
        try { fs.unlinkSync(ds.file_path); } catch (_) {}
      }
      const stmt = db.prepare('DELETE FROM ml_datasets WHERE id = ?');
      stmt.run(id);
      return true;
    } catch (err) {
      console.error('[ML DB] deleteDataset error:', err);
      return false;
    }
  },

  // Models
  getModels() {
    try {
      const stmt = db.prepare(`
        SELECT id, name, algorithm_type as type, version, status, purpose, configuration_json, created_at
        FROM ml_models
        ORDER BY id ASC
      `);
      return stmt.all().map(m => {
        let conf = {};
        try { conf = JSON.parse(m.configuration_json || '{}'); } catch (_) {}
        return {
          id: m.id,
          name: m.name,
          type: m.name === 'Isolation Forest' ? 'Unsupervised outlier detection' : (m.name === 'Local Outlier Factor' ? 'Density-based outlier detection' : 'Novelty / outlier detection'),
          version: m.version,
          status: m.status,
          purpose: m.purpose,
          configuration: conf
        };
      });
    } catch (err) {
      console.error('[ML DB] getModels error:', err);
      return [];
    }
  },

  saveModelConfig(id, config) {
    try {
      const stmt = db.prepare(`
        UPDATE ml_models
        SET configuration_json = ?
        WHERE id = ?
      `);
      stmt.run(JSON.stringify(config), id);
      return true;
    } catch (err) {
      console.error('[ML DB] saveModelConfig error:', err);
      return false;
    }
  },

  // Analyses
  getAnalyses() {
    try {
      const stmt = db.prepare(`
        SELECT a.id, a.name, a.algorithm, a.status, a.progress,
               a.records_processed as rows, a.flagged_records as flagged,
               a.date_from, a.date_to, a.parameters, a.feature_columns,
               a.created_at, a.completed_at,
               strftime('%d %b %Y', a.created_at) as date,
               COALESCE(d.name, a.dataset_id) as dataset,
               d.id as dataset_id
        FROM ml_analyses a
        LEFT JOIN ml_datasets d ON a.dataset_id = d.id
        ORDER BY a.created_at DESC
      `);
      return stmt.all();
    } catch (err) {
      console.error('[ML DB] getAnalyses error:', err);
      return [];
    }
  },

  getAnalysisById(id) {
    try {
      const stmt = db.prepare(`
        SELECT a.*, COALESCE(d.name, a.dataset_id) as dataset
        FROM ml_analyses a
        LEFT JOIN ml_datasets d ON a.dataset_id = d.id
        WHERE a.id = ?
      `);
      return stmt.get(id);
    } catch (err) {
      console.error('[ML DB] getAnalysisById error:', err);
      return null;
    }
  },

  createAnalysis({ id, name, dataset_id, model_id, algorithm, feature_columns, parameters, date_from, date_to }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO ml_analyses (
          id, name, dataset_id, model_id, algorithm, feature_columns, parameters, date_from, date_to, status, progress
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0.0)
      `);
      stmt.run(
        id,
        name,
        dataset_id,
        model_id || null,
        algorithm,
        JSON.stringify(feature_columns || []),
        JSON.stringify(parameters || {}),
        date_from || null,
        date_to || null
      );
      return this.getAnalysisById(id);
    } catch (err) {
      console.error('[ML DB] createAnalysis error:', err);
      throw err;
    }
  },

  // Results
  getResultsByAnalysisId(analysisId, filters = {}) {
    try {
      let query = `
        SELECT id, flight_id, timestamp, anomaly_score as score,
               model_label as flag, severity, supporting_features as signals,
               review_status, analysis_id as run, raw_data_json
        FROM ml_results
        WHERE analysis_id = ?
      `;
      const params = [analysisId];

      if (filters.search) {
        query += ` AND (flight_id LIKE ? OR supporting_features LIKE ?)`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
      }
      if (filters.severity && filters.severity !== 'all') {
        if (filters.severity === 'review') {
          query += ` AND severity = 'Review'`;
        } else {
          query += ` AND severity = ?`;
          params.push(filters.severity);
        }
      }
      if (filters.reviewStatus && filters.reviewStatus !== 'all') {
        query += ` AND review_status = ?`;
        params.push(filters.reviewStatus);
      }

      query += ` ORDER BY anomaly_score ASC`;

      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (err) {
      console.error('[ML DB] getResultsByAnalysisId error:', err);
      return [];
    }
  },

  updateResultReview(identifier, reviewStatus, notes = '', reviewer = 'Operator') {
    try {
      const findStmt = db.prepare(`
        SELECT id FROM ml_results
        WHERE id = ? OR flight_id = ?
        LIMIT 1
      `);
      const row = findStmt.get(identifier, identifier);
      if (!row) return false;

      const numId = row.id;

      const updateStmt = db.prepare(`
        UPDATE ml_results
        SET review_status = ?
        WHERE id = ?
      `);
      updateStmt.run(reviewStatus, numId);

      const logStmt = db.prepare(`
        INSERT INTO ml_review_records (result_id, review_status, notes, reviewer)
        VALUES (?, ?, ?, ?)
      `);
      logStmt.run(numId, reviewStatus, notes, reviewer);
      return true;
    } catch (err) {
      console.error('[ML DB] updateResultReview error:', err);
      return false;
    }
  },

  // Experiments
  getExperiments() {
    try {
      const stmt = db.prepare(`
        SELECT e.id, e.name, e.description, e.status, e.evaluation_method, e.summary_json,
               e.created_at, e.completed_at,
               strftime('%d %b %Y', e.created_at) as date,
               COALESCE(d.name, e.dataset_id) as dataset,
               d.id as dataset_id,
               e.algorithms as algorithms_json
        FROM ml_experiments e
        LEFT JOIN ml_datasets d ON e.dataset_id = d.id
        ORDER BY e.created_at DESC
      `);
      return stmt.all().map(exp => {
        let algos = [];
        try { algos = JSON.parse(exp.algorithms_json || '[]'); } catch (_) {}
        const algoLabels = algos.map(a => {
          if (a === 'isolation_forest') return 'Isolation Forest';
          if (a === 'lof') return 'Local Outlier Factor';
          if (a === 'one_class_svm') return 'One-Class SVM';
          return a;
        }).join(', ');

        let summary = {};
        try { summary = JSON.parse(exp.summary_json || '{}'); } catch (_) {}

        return {
          id: exp.id,
          name: exp.name,
          description: exp.description,
          dataset: exp.dataset,
          dataset_id: exp.dataset_id,
          models: algoLabels || 'Isolation Forest',
          date: exp.date,
          status: exp.status,
          summary
        };
      });
    } catch (err) {
      console.error('[ML DB] getExperiments error:', err);
      return [];
    }
  },

  getExperimentById(id) {
    try {
      const stmt = db.prepare(`
        SELECT e.*, COALESCE(d.name, e.dataset_id) as dataset
        FROM ml_experiments e
        LEFT JOIN ml_datasets d ON e.dataset_id = d.id
        WHERE e.id = ?
      `);
      const exp = stmt.get(id);
      if (!exp) return null;

      const runsStmt = db.prepare(`
        SELECT * FROM ml_experiment_runs WHERE experiment_id = ? ORDER BY id ASC
      `);
      exp.runs = runsStmt.all();
      return exp;
    } catch (err) {
      console.error('[ML DB] getExperimentById error:', err);
      return null;
    }
  },

  createExperiment({ id, name, description, dataset_id, algorithms, evaluation_method }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO ml_experiments (
          id, name, description, dataset_id, algorithms, evaluation_method, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'Pending')
      `);
      stmt.run(
        id,
        name,
        description || '',
        dataset_id,
        JSON.stringify(algorithms || ['isolation_forest']),
        evaluation_method || 'unsupervised'
      );
      return this.getExperimentById(id);
    } catch (err) {
      console.error('[ML DB] createExperiment error:', err);
      throw err;
    }
  },

  // -------------------------------------------------------------
  // FEATURE B: FLIGHT DELAY PREDICTIONS
  // -------------------------------------------------------------
  getDelayPredictions() {
    try {
      const stmt = db.prepare(`
        SELECT id, scenario_name, flight_id, airline, origin, destination,
               departure_time, distance_nm, weather_condition, congestion_level,
               inbound_delay_min, departure_delay_min, predicted_delay_min,
               risk_category, influencing_factors_json, model_version,
               strftime('%d %b %H:%M', created_at) as created_at_fmt,
               created_at
        FROM ml_delay_predictions
        ORDER BY id DESC
      `);
      return stmt.all().map(r => {
        let factors = [];
        try { factors = JSON.parse(r.influencing_factors_json || '[]'); } catch (_) {}
        return { ...r, influencing_factors: factors };
      });
    } catch (err) {
      console.error('[ML DB] getDelayPredictions error:', err);
      return [];
    }
  },

  getDelayPredictionById(id) {
    try {
      const stmt = db.prepare('SELECT * FROM ml_delay_predictions WHERE id = ?');
      const row = stmt.get(id);
      if (row && row.influencing_factors_json) {
        try { row.influencing_factors = JSON.parse(row.influencing_factors_json); } catch (_) {}
      }
      return row;
    } catch (err) {
      console.error('[ML DB] getDelayPredictionById error:', err);
      return null;
    }
  },

  // -------------------------------------------------------------
  // FEATURE C: WEATHER IMPACT SIMULATIONS
  // -------------------------------------------------------------
  getWeatherSimulations() {
    try {
      const stmt = db.prepare(`
        SELECT id, simulation_name, airport_or_route, weather_condition, severity_level,
               wind_speed_kt, visibility_km, simulated_delay_min,
               throughput_reduction_pct, holding_probability_pct, diversion_probability_pct,
               alternative_routes_json, operational_impact_summary, is_simulation,
               strftime('%d %b %H:%M', created_at) as created_at_fmt,
               created_at
        FROM ml_weather_simulations
        ORDER BY id DESC
      `);
      return stmt.all().map(s => {
        let alts = [];
        try { alts = JSON.parse(s.alternative_routes_json || '[]'); } catch (_) {}
        return { ...s, alternative_routes: alts };
      });
    } catch (err) {
      console.error('[ML DB] getWeatherSimulations error:', err);
      return [];
    }
  },

  // -------------------------------------------------------------
  // FEATURE D: ASK SKYWATCH AI CONVERSATION
  // -------------------------------------------------------------
  getAiQueries() {
    try {
      const stmt = db.prepare(`
        SELECT id, query, response, context_type, grounding_data_json,
               strftime('%d %b %H:%M', created_at) as created_at_fmt,
               created_at
        FROM ml_ai_queries
        ORDER BY id DESC
        LIMIT 20
      `);
      return stmt.all();
    } catch (err) {
      console.error('[ML DB] getAiQueries error:', err);
      return [];
    }
  }
};

module.exports = mlDb;
