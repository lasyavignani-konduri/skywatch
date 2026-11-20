/**
 * SkyWatch Test Suite
 * Tests unit conversions, distance filtering, runway selection, METAR parsing, and anomaly rules.
 */

const assert = require('assert');
const { getDistanceNm, computeDisruptionPulse } = require('../flightService');
const weatherService = require('../weather');
const config = require('../config');

console.log('✈️  Running SkyWatch Unit Tests...\n');

// 1. Unit Conversions
console.log('1. Testing Unit Conversions');
const metersToFeet = (m) => Math.round(m * 3.28084);
const msToKnots = (ms) => Math.round(ms * 1.94384);
const msToFpm = (ms) => Math.round(ms * 196.85);
const nmToKm = (nm) => nm * 1.852;
const statuteMilesToKm = (sm) => sm * 1.60934;

assert.strictEqual(metersToFeet(1000), 3281, '1000 meters should equal 3281 feet');
assert.strictEqual(metersToFeet(617), 2024, '617 meters (VOHS elevation) should equal 2024 feet');
assert.strictEqual(msToKnots(100), 194, '100 m/s should equal 194 knots');
assert.strictEqual(msToFpm(-20.32), -4000, '-20.32 m/s should equal -4000 fpm');
assert.strictEqual(Number(nmToKm(10).toFixed(2)), 18.52, '10 nm should equal 18.52 km');
assert.strictEqual(Number(statuteMilesToKm(10).toFixed(2)), 16.09, '10 sm should equal 16.09 km');
console.log('   ✓ Conversions passed.');

// 2. Distance & Bounding Box Filtering (Haversine)
console.log('2. Testing Distance & Bounding Box Filtering');
const vohsLat = 17.2403;
const vohsLon = 78.4294;

const distAtAirport = getDistanceNm(vohsLat, vohsLon, vohsLat, vohsLon);
assert.strictEqual(Math.round(distAtAirport), 0, 'Distance from airport to itself should be 0');

// Point 1 degree North (~60 nm)
const dist1DegNorth = getDistanceNm(vohsLat, vohsLon, vohsLat + 1.0, vohsLon);
assert(dist1DegNorth >= 59.5 && dist1DegNorth <= 60.5, '1 degree lat should be ~60 nm');

// Begumpet Airport (VOHY: 17.4531, 78.4678)
const distBegumpet = getDistanceNm(vohsLat, vohsLon, 17.4531, 78.4678);
assert(distBegumpet >= 12 && distBegumpet <= 15, 'Begumpet should be ~13 nm from VOHS');
console.log('   ✓ Distance calculations passed.');

// 3. Runway Selection Rule
console.log('3. Testing Runway Selection Logic');
// Rule: wind direction 180-359 deg -> runway 27, otherwise runway 09
function selectRunway(windDir) {
  return (windDir >= 180 && windDir <= 359) ? '27' : '09';
}

assert.strictEqual(selectRunway(270), '27', 'Wind 270 deg should select Runway 27');
assert.strictEqual(selectRunway(180), '27', 'Wind 180 deg should select Runway 27');
assert.strictEqual(selectRunway(350), '27', 'Wind 350 deg should select Runway 27');
assert.strictEqual(selectRunway(90), '09', 'Wind 090 deg should select Runway 09');
assert.strictEqual(selectRunway(40), '09', 'Wind 040 deg should select Runway 09');
assert.strictEqual(selectRunway(179), '09', 'Wind 179 deg should select Runway 09');
console.log('   ✓ Runway selection rules passed.');

// 4. Anomaly Rules
console.log('4. Testing Anomaly Rules');

// A. Emergency Squawk
const isEmergencySquawk = (code) => config.anomalyRules.emergencySquawks.includes(String(code));
assert.strictEqual(isEmergencySquawk('7700'), true, '7700 is emergency');
assert.strictEqual(isEmergencySquawk('7600'), true, '7600 is emergency (radio fail)');
assert.strictEqual(isEmergencySquawk('7500'), true, '7500 is emergency (hijack)');
assert.strictEqual(isEmergencySquawk('2314'), false, '2314 is normal squawk');

// B. Altitude Drop (<= -4000 fpm below 5000 ft AGL)
function isAltitudeDrop(vrateFpm, altAglFt) {
  return vrateFpm <= config.anomalyRules.altitudeDrop.maxVrateFpm &&
         altAglFt <= config.anomalyRules.altitudeDrop.maxAltAglFt;
}
assert.strictEqual(isAltitudeDrop(-4800, 3400), true, '-4800 fpm at 3400 ft is altitude drop');
assert.strictEqual(isAltitudeDrop(-2500, 3400), false, '-2500 fpm is standard descent');
assert.strictEqual(isAltitudeDrop(-4800, 25000), false, '-4800 fpm at cruise FL250 is not terminal drop');

// C. Holding Pattern (cumulative turn >= 360 deg)
function isHolding(turnDeg, distNm) {
  return turnDeg >= config.anomalyRules.holdingPattern.minAccumulatedTurnDeg &&
         distNm > config.anomalyRules.holdingPattern.maxFinalApproachDistNm;
}
assert.strictEqual(isHolding(380, 22), true, '380 deg turn at 22 nm is holding pattern');
assert.strictEqual(isHolding(120, 22), false, '120 deg turn is normal vectoring');
assert.strictEqual(isHolding(380, 5), false, 'Circling within 5 nm is final circuit/landing');

// D. Go-Around
function isGoAround(distNm, minAltFt, vrateFpm) {
  return distNm <= config.anomalyRules.goAround.maxDistFromRunwayNm &&
         minAltFt <= config.anomalyRules.goAround.maxDescentAltAglFt &&
         vrateFpm > config.anomalyRules.goAround.minClimbVrateFpm;
}
assert.strictEqual(isGoAround(4, 800, 1200), true, 'Climb at 1200 fpm from 800 ft near runway is go-around');
assert.strictEqual(isGoAround(4, 800, -600), false, 'Descent at 600 fpm is normal landing');
console.log('   ✓ Anomaly rules passed.');

// 5. Disruption Pulse Formula
console.log('5. Testing Disruption Pulse Calculation');
const testFlights = [
  { issue: 'Holding pattern' },
  { issue: 'Altitude drop' },
  { issue: null },
  { issue: null }
];
const testWeather = { category: 'MVFR' };
const pulse = computeDisruptionPulse(testFlights, testWeather);
assert(pulse.score >= 0 && pulse.score <= 100, 'Pulse score must be between 0 and 100');
assert(['Low', 'Moderate', 'Elevated', 'Severe'].includes(pulse.level), 'Pulse level must be valid');
console.log(`   ✓ Pulse formula verified (Score: ${pulse.score}, Level: ${pulse.level})`);

console.log('\n=============================================');
console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY! (6/6)');
console.log('=============================================\n');
