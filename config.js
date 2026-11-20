// SkyWatch Airspace Operations Configuration - Rajiv Gandhi International Airport (VOHS)
module.exports = {
  airport: {
    icao: 'VOHS',
    iata: 'HYD',
    name: 'Rajiv Gandhi International Airport, Hyderabad',
    lat: 17.2403,
    lon: 78.4294,
    elevationFt: 2024,
    radiusNm: 60,
    timeZone: 'Asia/Kolkata'
  },

  // Authoritative runway data from official AIP / OurAirports for VOHS
  runways: [
    {
      id: '09R/27L',
      lengthM: 4260,
      widthM: 60,
      heading09: 91,
      heading27: 271,
      threshold09: { lat: 17.2286, lon: 78.4128 },
      threshold27: { lat: 17.2291, lon: 78.4529 }
    },
    {
      id: '09L/27R',
      lengthM: 3707,
      widthM: 45,
      heading09: 91,
      heading27: 271,
      threshold09: { lat: 17.2435, lon: 78.4162 },
      threshold27: { lat: 17.2440, lon: 78.4510 }
    }
  ],

  // Bounding box for OpenSky state vector fetch (approx +/- 1.05 deg)
  boundingBox: {
    lamin: 16.2403,
    lamax: 18.2403,
    lomin: 77.3794,
    lomax: 79.4794
  },

  // Fallback ADS-B Aggregator endpoints
  adsbEndpoints: [
    { name: 'adsb_lol', url: 'https://api.adsb.lol/v2/point/17.2403/78.4294/60' },
    { name: 'airplanes_live', url: 'https://api.airplanes.live/v2/point/17.2403/78.4294/60' },
    { name: 'adsb_fi', url: 'https://opendata.adsb.fi/api/v2/lat/17.2403/lon/78.4294/dist/60' }
  ],

  metarUrl: 'https://aviationweather.gov/api/data/metar?ids=VOHS&format=json',

  // Anomaly Detection Thresholds
  anomalyRules: {
    emergencySquawks: ['7500', '7600', '7700'],
    altitudeDrop: {
      maxVrateFpm: -4000,
      maxAltAglFt: 5000,
      minConsecutiveReadings: 2
    },
    holdingPattern: {
      minAccumulatedTurnDeg: 360,
      windowMinutes: 6,
      maxFinalApproachDistNm: 12
    },
    goAround: {
      maxDescentAltAglFt: 2000,
      maxDistFromRunwayNm: 10,
      minClimbVrateFpm: 500
    },
    signalLost: {
      maxAltAglFt: 10000,
      timeoutSeconds: 60
    },
    cooldownSeconds: 300 // 5 minutes per flight per rule
  },

  polling: {
    flightIntervalMs: 12000, // 12 seconds
    weatherIntervalMs: 300000, // 5 minutes
    streamPushIntervalMs: 10000 // 10 seconds
  }
};
