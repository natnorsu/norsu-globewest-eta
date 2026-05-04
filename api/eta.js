const https = require('https');

// Cache to avoid hammering SearchSpring on every page load
// TTL: 30 minutes
const cache = {};
const CACHE_TTL = 30 * 60 * 1000;

// GlobeWest SearchSpring site ID
const SS_SITE_ID = 'xq8j7f';

/**
 * Convert a Norsu product handle to a GlobeWest search query.
 * Strips the globewest- or globe-west- prefix, then replaces dashes with spaces.
 * e.g. "globewest-winona-occasional-chair-caramel-latte" -> "winona occasional chair caramel latte"
 */
function handleToQuery(handle) {
  return handle
    .replace(/^globewest-/, '')
    .replace(/^globe-west-/, '')
    .replace(/-copy$/, '')
    .replace(/-([0-9]+)$/, '')
    .replace(/-/g, ' ')
    .trim();
}

/**
 * Decode HTML entities from a string (e.g. &lt; -> <, &quot; -> ")
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Parse the ETA text from GlobeWest's ss_gw_eta_label HTML field.
 * The field comes HTML-entity-encoded, e.g.:
 *   &lt;div ...&gt;&lt;span id="eta-data"&gt;ETA - 14/05/26&lt;/span&gt;&lt;/div&gt;
 * Returns normalised text like "ETA 14/05/26" or "In Stock".
 */
function parseEtaLabel(html) {
  if (!html) return null;
  const decoded = decodeHtmlEntities(html);
  const match = decoded.match(/id="eta-data"[^>]*>([^<]+)</) ||
                decoded.match(/class="data"[^>]*>([^<]+)</) ||
                decoded.match(/>([^<]+)</);
  if (!match) return null;
  const raw = match[1].trim();
  // Normalise "ETA - 14/05/26" -> "ETA 14/05/26"
  return raw.replace(/ETA\s*-\s*/, 'ETA ').trim();
}

/**
 * Parse status from ETA label HTML class name and text.
 */
function parseStatus(html, etaText) {
  if (!html || !etaText) return 'unknown';
  const decoded = decodeHtmlEntities(html);
  if (decoded.includes('old-eta-date')) return 'eta';
  if (decoded.includes('old-in-stock')) return 'in_stock';
  const lower = etaText.toLowerCase();
  if (lower.includes('limited')) return 'limited_stock';
  if (lower.includes('in stock')) return 'in_stock';
  if (lower.includes('eta')) return 'eta';
  return 'unknown';
}

/**
 * Parse date from ETA text.
 * e.g. "ETA 14/05/26" -> "2026-05-14"
 */
function parseDate(etaText) {
  if (!etaText) return null;
  const m = etaText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const year = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${year}-${month}-${day}`;
}

/**
 * Fetch product data from GlobeWest SearchSpring API.
 * Returns { url, etaLabel, name } or throws.
 */
function fetchFromSearchSpring(query) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    const path = `/api/search/search.json?siteId=${SS_SITE_ID}&q=${encoded}&resultsFormat=native&resultsPerPage=1`;
    const options = {
      hostname: 'api.searchspring.net',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NorsuETA/1.0)',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = json.results || [];
          if (!results.length) {
            return reject(new Error('No results found for: ' + query));
          }
          const r = results[0];
          resolve({
            url: r.url,
            etaLabel: r.ss_gw_eta_label || '',
            name: r.name || r.title || '',
          });
        } catch (e) {
          reject(new Error('Failed to parse SearchSpring response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('SearchSpring timeout')); });
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const handle = (req.query.handle || '').toLowerCase().trim();
  if (!handle) {
    return res.status(400).json({ error: 'Missing handle parameter' });
  }

  // Check cache
  const now = Date.now();
  if (cache[handle] && (now - cache[handle].ts) < CACHE_TTL) {
    return res.status(200).json({ ...cache[handle].data, cached: true });
  }

  try {
    const query = handleToQuery(handle);
    const { url, etaLabel, name } = await fetchFromSearchSpring(query);
    const etaText = parseEtaLabel(etaLabel);
    const status = parseStatus(etaLabel, etaText);
    const etaDate = parseDate(etaText);

    const data = {
      handle,
      name,
      eta_text: etaText,
      eta_date: etaDate,
      status,
      source_url: url,
      fetched_at: new Date().toISOString(),
    };

    cache[handle] = { data, ts: now };
    return res.status(200).json({ ...data, cached: false });

  } catch (err) {
    return res.status(200).json({
      handle,
      error: err.message,
      eta_text: null,
      status: 'unknown',
    });
  }
};
