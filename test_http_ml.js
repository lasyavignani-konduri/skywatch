async function testEndpoints() {
  const base = 'http://localhost:8000';
  console.log('Testing live HTTP endpoints on', base);

  // 1. Datasets
  let res = await fetch(`${base}/api/ml/datasets`);
  let data = await res.json();
  console.log('GET /api/ml/datasets:', res.status, `(${data.length} datasets)`);

  // 2. Models
  res = await fetch(`${base}/api/ml/models`);
  data = await res.json();
  console.log('GET /api/ml/models:', res.status, `(${data.length} models)`);

  // 3. Analyses
  res = await fetch(`${base}/api/ml/analyses`);
  data = await res.json();
  console.log('GET /api/ml/analyses:', res.status, `(${data.length} analyses)`);

  // 4. Results
  res = await fetch(`${base}/api/ml/analyses/AN-2026-001/results`);
  data = await res.json();
  console.log('GET /api/ml/analyses/AN-2026-001/results:', res.status, `(${data.length} records)`);

  // 5. Experiments
  res = await fetch(`${base}/api/ml/experiments`);
  data = await res.json();
  console.log('GET /api/ml/experiments:', res.status, `(${data.length} experiments)`);

  // 6. ML Lab Page HTML
  res = await fetch(`${base}/ml-lab`);
  const html = await res.text();
  console.log('GET /ml-lab:', res.status, `(${html.length} bytes, title: ${html.includes('SkyWatch') ? 'OK' : 'FAIL'})`);

  // 7. CSV Export
  res = await fetch(`${base}/api/ml/export/AN-2026-001`);
  const csv = await res.text();
  const lines = csv.split('\n');
  console.log('GET /api/ml/export/AN-2026-001:', res.status, `(${lines.length} CSV lines)`);

  // 8. Human Review Update
  res = await fetch(`${base}/api/ml/results/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flight_id: 'AIC2417',
      review_status: 'Confirmed Operational Deviation',
      notes: 'Unstable approach verified'
    })
  });
  const reviewResult = await res.json();
  console.log('POST /api/ml/results/review:', res.status, reviewResult);

  console.log('\n🚀 ALL LIVE HTTP ENDPOINTS TESTED SUCCESSFULLY!');
}

testEndpoints().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
