const https = require('https');

const ETA_MAP = {
  'globe-west-artie-buffet-powder-blue':  'artie-buffet-powder-blue-buf-art',
  'globe-west-artie-buffet':              'artie-buffet-washed-terracotta-buf-art',
  'globe-west-artie-buffet-natural-ash':  'artie-buffet-natural-ash-buf-art',
  'globe-west-artie-buffet-eucalyptus':   'artie-buffet-eucalyptus-buf-art',
  'globe-west-artie-buffet-putty':        'artie-buffet-putty-buf-art',
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = {};

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorsuETABot/1.0)', 'Accept': 'text/html' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseETA(html) {
  const etaMatch = html.match(/id="eta-data">([^<]+)</);
  const containerMatch = html.match(/product-eta-container ([^"]*?)"/);
  if (!etaMatch) return null;
  const etaText = etaMatch[1].trim();
  const containerClass = containerMatch ? containerMatch[1].trim() : '';
  let status = 'unknown';
  if (containerClass.includes('in-stock') || etaText === 'In Stock') status = 'in_stock';
  else if (etaText === 'Limited Stock') status = 'limited_stock';
  else if (containerClass.includes('eta-date') || etaText.startsWith('ETA')) status = 'eta';
  let etaDate = null;
  const dateMatch = etaText.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    const fullYear = year.length === 2 ? '20' + year : year;
    etaDate = fullYear + '-' + month + '-' + day;
  }
  return { eta_text: etaText, eta_date: etaDate, status };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const handle = (req.query.handle || '').toLowerCase().trim();
  if (!handle) return res.status(400).json({ error: 'Missing ?handle= parameter' });
  const slug = ETA_MAP[handle];
  if (!slug) return res.status(404).json({ error: 'Handle not in ETA_MAP', handle });
  const cached = cache[handle];
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, cached: true });
  }
  const globeWestURL = 'https://www.globewest.com.au/' + slug;
  try {
    const html = await fetchURL(globeWestURL);
    const parsed = parseETA(html);
    if (!parsed) return res.status(502).json({ error: 'Could not parse ETA', url: globeWestURL });
    const result = { handle, ...parsed, source_url: globeWestURL, fetched_at: new Date().toISOString(), cached: false };
    cache[handle] = { data: result, fetchedAt: Date.now() };
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
};
