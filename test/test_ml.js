const assert = require('assert');
const mlDb = require('../mlDb');

console.log('✈️  Running SkyWatch Machine Learning Lab Tests...\n');

// 1. Datasets Test
console.log('1. Testing ML Datasets Storage');
const datasets = mlDb.getDatasets();
assert(datasets.length >= 3, 'Should have at least 3 seeded operational datasets');
console.log(`   ✓ Found ${datasets.length} datasets:`, datasets.map(d => d.name));

const ds = mlDb.getDatasetById('ds-runway-demo');
assert(ds, 'Runway dataset should exist');
assert.strictEqual(ds.kind, 'CSV');
assert(ds.rows > 0, 'Dataset should contain rows');
console.log(`   ✓ Verified dataset ${ds.name} with ${ds.rows} rows and ${ds.columns} columns.`);

// 2. Models Test
console.log('\n2. Testing ML Model Catalogue');
const models = mlDb.getModels();
assert(models.length >= 3, 'Should have 3 models registered (IF, LOF, OCSVM)');
const ifModel = models.find(m => m.id === 'MDL-IF-01');
assert(ifModel, 'Isolation Forest model should be available');
assert.strictEqual(ifModel.status, 'Available');
console.log(`   ✓ Verified ${models.length} models:`, models.map(m => m.name));

// 3. Model Configuration Update Test
console.log('\n3. Testing Hyperparameter Persistence');
const newConfig = { n_estimators: 250, contamination: 0.02, max_samples: 512 };
const saved = mlDb.saveModelConfig('MDL-IF-01', newConfig);
assert(saved, 'Model config should update successfully');
const updatedModels = mlDb.getModels();
const updatedIf = updatedModels.find(m => m.id === 'MDL-IF-01');
assert.strictEqual(updatedIf.configuration.n_estimators, 250);
console.log('   ✓ Model config persisted and reloaded correctly.');

// 4. Analyses & Results Test
console.log('\n4. Testing ML Analyses and Detection Results');
const analyses = mlDb.getAnalyses();
assert(analyses.length >= 3, 'Should have completed initial analyses');
const an1 = analyses.find(a => a.id === 'AN-2026-001');
assert(an1, 'AN-2026-001 should exist');
assert.strictEqual(an1.status, 'Completed');
assert(an1.rows > 0, 'Should have processed rows');
console.log(`   ✓ Analysis ${an1.id} (${an1.name}): ${an1.rows} rows processed, ${an1.flagged} flagged.`);

const results = mlDb.getResultsByAnalysisId('AN-2026-001');
assert(results.length > 0, 'Should return scored results');
const topOutlier = results[0];
assert(topOutlier.flight_id, 'Result should have flight_id');
assert(typeof topOutlier.score === 'number', 'Result should have numeric anomaly score');
assert(topOutlier.review_status, 'Result should have review_status');
console.log(`   ✓ Results verified. Top outlier: ${topOutlier.flight_id}, score: ${topOutlier.score}, signals: ${topOutlier.signals}`);

// 5. Human Review Workflow Test
console.log('\n5. Testing Human Review Status Workflow');
const flightToReview = topOutlier.flight_id;
const reviewOk = mlDb.updateResultReview(flightToReview, 'Confirmed Operational Deviation', 'Excessive descent rate on 5nm final', 'Chief Controller');
assert(reviewOk, 'Review status should update');
const refreshedResults = mlDb.getResultsByAnalysisId('AN-2026-001');
const reviewedItem = refreshedResults.find(r => r.flight_id === flightToReview);
assert.strictEqual(reviewedItem.review_status, 'Confirmed Operational Deviation');
console.log(`   ✓ Human review workflow verified: ${flightToReview} updated to "${reviewedItem.review_status}".`);

// 6. Experiments Test
console.log('\n6. Testing Multi-Algorithm Experiments');
const experiments = mlDb.getExperiments();
assert(experiments.length >= 1, 'Should have at least 1 experiment');
const exp1 = experiments[0];
assert(exp1.summary, 'Experiment should have comparison summary');
console.log(`   ✓ Experiment ${exp1.id} (${exp1.name}) verified with algorithms: ${exp1.models}.`);

console.log('\n======================================================');
console.log('🎉 ALL MACHINE LEARNING LAB TESTS PASSED! (6/6)');
console.log('======================================================\n');
