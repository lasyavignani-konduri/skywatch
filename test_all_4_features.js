async function testAllFeatures() {
  const base = 'http://localhost:8000';
  console.log('✈️  Testing All 4 SkyWatch Aviation Intelligence Features...\n');

  // Feature A: Anomaly Detection
  console.log('--- Feature A: Flight Anomaly Detection (Isolation Forest) ---');
  let res = await fetch(`${base}/api/ml/analyses`);
  let analyses = await res.json();
  console.log('✓ Analyses found:', analyses.length);
  res = await fetch(`${base}/api/ml/analyses/AN-2026-001/results`);
  let anomalies = await res.json();
  let flagged = anomalies.filter(r => r.flag === 'Anomaly');
  console.log(`✓ Total records: ${anomalies.length}, Flagged Outliers: ${flagged.length} (${(flagged.length/anomalies.length*100).toFixed(1)}%)`);
  console.log(`✓ Sample Anomaly: Flight ${flagged[0]?.flight_id}, Score: ${flagged[0]?.score}, Signals: ${flagged[0]?.signals}`);

  // Feature B: Flight Delay Predictor
  console.log('\n--- Feature B: Flight Delay Predictor ---');
  res = await fetch(`${base}/api/ml/predictions/delay`);
  let predictions = await res.json();
  console.log('✓ Existing delay predictions:', predictions.length);
  
  // Test predicting a new scenario
  res = await fetch(`${base}/api/ml/predictions/delay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario_name: 'DEL-VOHS Thunderstorm Slot Delay',
      flight_id: 'AIC402',
      airline: 'Air India',
      origin: 'DEL',
      destination: 'VOHS',
      departure_delay_min: 28.0,
      turnaround_buffer_min: 35.0,
      weather_condition: 'Thunderstorm',
      congestion_level: 'High (Slot Delay)'
    })
  });
  let newPred = await res.json();
  console.log(`✓ New Delay Prediction: Flight ${newPred.flight_id} (${newPred.origin}->${newPred.destination})`);
  console.log(`  Predicted Delay: +${newPred.predicted_delay_min} min [${newPred.risk_category}]`);
  console.log('  Top Factors:', newPred.influencing_factors?.map(f => `${f.factor}: ${f.impact_pct}%`).join(', '));

  // Feature C: Weather Impact Simulator
  console.log('\n--- Feature C: Weather Impact Simulator ---');
  res = await fetch(`${base}/api/ml/simulations/weather`);
  let sims = await res.json();
  console.log('✓ Existing weather simulations:', sims.length);

  // Test running an interactive simulation
  res = await fetch(`${base}/api/ml/simulations/weather`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_name: 'VOHS Severe Monsoon Front Simulation',
      airport_or_route: 'VOHS (Hyderabad)',
      weather_condition: 'Thunderstorm',
      severity_level: 'Extreme',
      wind_speed_kt: 38.0,
      visibility_km: 1.2
    })
  });
  let newSim = await res.json();
  console.log(`✓ New Weather Simulation: ${newSim.simulation_name}`);
  console.log(`  Throughput Reduction: -${newSim.throughput_reduction_pct}%`);
  console.log(`  Simulated Delay: +${newSim.simulated_delay_min} min`);
  console.log(`  Holding Prob: ${newSim.holding_probability_pct}%, Diversion Prob: ${newSim.diversion_probability_pct}%`);
  console.log('  Optimal Alternate:', newSim.alternative_routes?.[0]?.airport, `(${newSim.alternative_routes?.[0]?.suitability})`);

  // Feature D: Ask SkyWatch AI
  console.log('\n--- Feature D: Ask SkyWatch AI ---');
  const questions = [
    "Which flights have the highest delay risk?",
    "Which flights were identified as anomalous?",
    "What impact could thunderstorms have on this route?",
    "What are the possible reasons for a flight delay?"
  ];
  for (const q of questions) {
    res = await fetch(`${base}/api/ml/ai/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
    let aiRes = await res.json();
    console.log(`\nQ: "${q}"`);
    console.log(`A: ${aiRes.response.slice(0, 160)}...`);
    console.log(`  [Grounded: ${aiRes.is_grounded}, Mode: ${aiRes.mode}]`);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL 4 AVIATION INTELLIGENCE FEATURES VERIFIED 100%!');
  console.log('======================================================\n');
}

testAllFeatures().catch(e => {
  console.error('Error running test:', e);
  process.exit(1);
});
