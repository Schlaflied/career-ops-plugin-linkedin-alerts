// career-ops-plugin-gmail
// Author: Schlaflied · https://github.com/Schlaflied
// License: MIT · https://github.com/Schlaflied/career-ops-plugin-gmail
//
// Reads job alert emails from Gmail (LinkedIn alerts by default), extracts
// job posting URLs and titles, and returns them as Job[] for the
// career-ops pipeline. Dedup against tracker/history is handled by the
// engine — this plugin only surfaces candidates.
// Network access only via ctx.fetch (engine enforces allowedHosts).

const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getAccessToken(ctx) {
  const res = await ctx.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     ctx.env.GMAIL_CLIENT_ID,
      client_secret: ctx.env.GMAIL_CLIENT_SECRET,
      refresh_token: ctx.env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

function gmailDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

async function listMessages(ctx, accessToken) {
  const sender = ctx.settings?.sender ?? 'jobalerts-noreply@linkedin.com';
  const days   = ctx.settings?.days ?? 7;

  const params = new URLSearchParams({
    q:          `from:${sender} after:${gmailDate(days)}`,
    maxResults: String(ctx.settings?.maxResults ?? 50),
  });

  const res = await ctx.fetch(`${GMAIL_BASE}/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.messages || [];
}

async function getMessage(ctx, accessToken, id) {
  const res = await ctx.fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Gmail bodies are base64url-encoded; normalize before decoding
function decodeData(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function decodeBody(part) {
  if (part?.body?.data) return decodeData(part.body.data);
  for (const p of part?.parts || []) {
    const r = decodeBody(p);
    if (r) return r;
  }
  return '';
}

function getHeader(message, name) {
  const headers = message.payload?.headers || [];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Extract canonical LinkedIn job URLs from alert email body.
// Handles direct links (/jobs/view/123), comm tracking links, and
// ?currentJobId= / ?jobId= query forms.
function extractJobUrls(body) {
  const urlPattern = /https:\/\/(?:www\.)?linkedin\.com\/(?:comm\/)?[^\s"<>\]]+/g;
  const found = [];
  const seen  = new Set();
  let match;

  while ((match = urlPattern.exec(body)) !== null) {
    const url = match[0].replace(/&amp;/g, '&').split('"')[0];
    const jobIdMatch = url.match(/\/jobs\/view\/(\d{7,})|[?&](?:currentJobId|jobId)=(\d{7,})/);
    if (!jobIdMatch) continue;
    const jobId    = jobIdMatch[1] || jobIdMatch[2];
    const cleanUrl = `https://www.linkedin.com/jobs/view/${jobId}`;
    if (!seen.has(cleanUrl)) {
      seen.add(cleanUrl);
      found.push(cleanUrl);
    }
  }
  return found;
}

// Parse LinkedIn alert subject lines:
//   "Lightspeed Commerce is hiring a AI Enablement Specialist"
//   "3 new HR Coordinator jobs for you"
//   "New jobs for you: HR Coordinator, People Operations"
function parseSubject(subject) {
  let m = subject.match(/^(.+?) is hiring (?:a |an )?(.+)$/i);
  if (m) return { company: m[1].trim(), title: m[2].trim() };

  m = subject.match(/new (?:\w+ )?jobs? for you:?\s*(.+)$/i);
  if (m) return { company: '', title: m[1].trim().split(',')[0].trim() };

  m = subject.match(/^\d+ new (.+?) jobs?/i);
  if (m) return { company: '', title: m[1].trim() };

  return { company: '', title: subject.trim() };
}

// Optional keyword filters from settings (empty = no filtering)
function passesFilter(title, ctx) {
  const t        = title.toLowerCase();
  const positive = ctx.settings?.titleKeywords ?? [];
  const negative = ctx.settings?.excludeKeywords ?? [];

  if (negative.some(k => t.includes(String(k).toLowerCase()))) return false;
  if (positive.length > 0 && !positive.some(k => t.includes(String(k).toLowerCase()))) return false;
  return true;
}

export default {
  async ingest(ctx) {
    const accessToken = await getAccessToken(ctx);
    const messages    = await listMessages(ctx, accessToken);

    const jobs = [];
    const seen = new Set();

    for (const { id } of messages) {
      const message = await getMessage(ctx, accessToken, id);
      const subject = getHeader(message, 'Subject');
      const { company, title } = parseSubject(subject);

      if (!passesFilter(title, ctx)) continue;

      const body = decodeBody(message.payload || {});
      for (const url of extractJobUrls(body)) {
        if (seen.has(url)) continue;
        seen.add(url);
        jobs.push({
          title,
          url,
          company: company || '(LinkedIn)',
          location: '',
        });
      }
    }

    return jobs;
  },
};
