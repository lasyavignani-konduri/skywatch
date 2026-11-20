const config = require('./config');

let lastGoodWeather = {
  category: 'VFR',
  visibilityKm: 5,
  cloudCover: 'FEW',
  cloudBaseFt: '2,000',
  windDir: 10,
  windKt: 3,
  headwindKt: 3,
  crosswindKt: 0,
  runwayPill: 'Calm',
  qnh: 1014,
  tempC: 28,
  activeRunway: '09',
  isStale: false,
  obsTime: new Date().toISOString(),
  raw: 'VOHS 201130Z 01003KT 5000 HZ FEW020 28/15 Q1014 NOSIG'
};

let lastFetchTime = 0;

function parseVisibility(visib) {
  if (visib === undefined || visib === null) return 5;
  if (typeof visib === 'string') {
    visib = parseFloat(visib.replace('+', ''));
  }
  if (visib <= 15) {
    return Math.round(visib * 1.60934);
  }
  return Math.round(visib / 1000);
}

function parseQnh(altim) {
  if (!altim) return 1014;
  if (altim < 50) {
    return Math.round(altim * 33.8639);
  }
  return Math.round(altim);
}

function parseCloudLayer(clouds) {
  if (!clouds || !Array.isArray(clouds) || clouds.length === 0) {
    return { cover: 'FEW', baseFt: '2,000' };
  }
  const layer = clouds[0];
  const cover = layer.cover || 'FEW';
  const base = layer.base ? Number(layer.base).toLocaleString() : '2,000';
  return { cover, baseFt: base };
}

function computeWindComponents(windDir, windKt, activeRunway) {
  const rwyHeading = activeRunway === '27' ? 270 : 90;
  const angleRad = ((windDir - rwyHeading) * Math.PI) / 180;
  const headwindKt = Math.max(0, Math.round(windKt * Math.cos(angleRad)));
  const crosswindKt = Math.abs(Math.round(windKt * Math.sin(angleRad)));

  let runwayPill = 'Calm';
  if (crosswindKt >= 15) {
    runwayPill = 'Crosswind Alert';
  } else if (crosswindKt <= 5 && windKt <= 8) {
    runwayPill = 'Calm';
  } else {
    runwayPill = 'Moderate';
  }

  return { headwindKt, crosswindKt, runwayPill };
}

// Parse standard ICAO raw METAR string
function parseRawMetar(rawText) {
  try {
    const tokens = rawText.trim().split(/\s+/);
    let wdir = 10;
    let wspd = 3;
    let visKm = 5;
    let qnh = 1014;
    let tempC = 28;
    let cloudCover = 'FEW';
    let cloudBaseFt = '2,000';

    for (const tok of tokens) {
      // Wind: e.g. 01003KT, 27012G20KT, VRB02KT
      const windMatch = tok.match(/^(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT$/);
      if (windMatch) {
        wdir = windMatch[1] === 'VRB' ? 270 : parseInt(windMatch[1], 10);
        wspd = parseInt(windMatch[2], 10);
      }
      // Visibility in meters: e.g. 5000, 9999, 3000
      else if (/^\d{4}$/.test(tok)) {
        visKm = Math.round(parseInt(tok, 10) / 1000);
      }
      // Cloud layer: e.g. FEW020, SCT015, BKN025, OVC010
      else if (/^(FEW|SCT|BKN|OVC)(\d{3})$/.test(tok)) {
        const m = tok.match(/^(FEW|SCT|BKN|OVC)(\d{3})$/);
        cloudCover = m[1];
        cloudBaseFt = Number(parseInt(m[2], 10) * 100).toLocaleString();
      }
      // Temp / Dewpoint: e.g. 28/15, M02/M05
      else if (/^(M?\d{2})\/(M?\d{2})$/.test(tok)) {
        const tm = tok.match(/^(M?\d{2})\/(M?\d{2})$/);
        tempC = parseInt(tm[1].replace('M', '-'), 10);
      }
      // QNH: e.g. Q1014, A2992
      else if (/^Q(\d{4})$/.test(tok)) {
        qnh = parseInt(tok.substring(1), 10);
      }
    }

    let category = 'VFR';
    if (visKm < 5 || (cloudCover === 'BKN' || cloudCover === 'OVC') && parseInt(cloudBaseFt.replace(',', '')) < 1000) {
      category = 'IFR';
    } else if (visKm < 8 || (cloudCover === 'BKN' || cloudCover === 'OVC') && parseInt(cloudBaseFt.replace(',', '')) < 3000) {
      category = 'MVFR';
    }

    const activeRunway = (wdir >= 180 && wdir <= 359) ? '27' : '09';
    const { headwindKt, crosswindKt, runwayPill } = computeWindComponents(wdir, wspd, activeRunway);

    return {
      category,
      visibilityKm: visKm,
      cloudCover,
      cloudBaseFt,
      windDir: wdir,
      windKt: wspd,
      headwindKt,
      crosswindKt,
      runwayPill,
      qnh,
      tempC,
      activeRunway,
      isStale: false,
      obsTime: new Date().toISOString(),
      raw: rawText.trim()
    };
  } catch (e) {
    return null;
  }
}

async function fetchMetar() {
  const now = Date.now();
  // Refresh if older than 3 minutes
  if (now - lastFetchTime < 180000 && lastFetchTime > 0) {
    return lastGoodWeather;
  }

  // 1. Try VATSIM METAR endpoint (ultra-fast, real-time worldwide METAR)
  try {
    const vatsimRes = await fetch('https://metar.vatsim.net/VOHS', { signal: AbortSignal.timeout(4000) });
    if (vatsimRes.ok) {
      const rawText = await vatsimRes.text();
      if (rawText && rawText.includes('VOHS')) {
        const parsed = parseRawMetar(rawText);
        if (parsed) {
          lastGoodWeather = parsed;
          lastFetchTime = now;
          return lastGoodWeather;
        }
      }
    }
  } catch (e) {}

  // 2. Try AviationWeather API
  try {
    const res = await fetch(config.metarUrl, {
      headers: { 'User-Agent': 'SkyWatch/2.0' },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const obs = data[0];
        const obsTimeSec = obs.obsTime || Math.floor(now / 1000);
        let wdir = obs.wdir === 'VRB' || obs.wdir === undefined || obs.wdir === null ? 10 : Number(obs.wdir);
        const wspd = obs.wspd !== undefined && obs.wspd !== null ? Number(obs.wspd) : 3;
        const visKm = parseVisibility(obs.visib);
        const qnh = parseQnh(obs.altim);
        const clouds = parseCloudLayer(obs.clouds);
        const category = obs.fltCat || 'VFR';

        const activeRunway = (wdir >= 180 && wdir <= 359) ? '27' : '09';
        const { headwindKt, crosswindKt, runwayPill } = computeWindComponents(wdir, wspd, activeRunway);

        lastGoodWeather = {
          category,
          visibilityKm: visKm,
          cloudCover: clouds.cover,
          cloudBaseFt: clouds.baseFt,
          windDir: wdir,
          windKt: wspd,
          headwindKt,
          crosswindKt,
          runwayPill,
          qnh,
          tempC: obs.temp !== undefined ? obs.temp : 28,
          activeRunway,
          isStale: false,
          obsTime: new Date(obsTimeSec * 1000).toISOString(),
          raw: obs.rawOb || 'VOHS METAR'
        };

        lastFetchTime = now;
        return lastGoodWeather;
      }
    }
  } catch (err) {}

  return lastGoodWeather;
}

function getWeather() {
  return lastGoodWeather;
}

// Fetch on module load
fetchMetar();

module.exports = {
  fetchMetar,
  getWeather,
  computeWindComponents
};
