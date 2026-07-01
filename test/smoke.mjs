// Smoke test — verifies plugin contract without hitting Google APIs
import plugin from '../index.mjs';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else           { console.error(`  ❌ ${msg}`); failed++; }
}

// Gmail returns base64url-encoded bodies
function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SAMPLE_MESSAGES = {
  'msg-1': {
    payload: {
      headers: [{ name: 'Subject', value: 'Lightspeed Commerce is hiring a AI Enablement Specialist' }],
      body: { data: b64url(
        'Apply now: https://www.linkedin.com/comm/jobs/view/4001234567?trackingId=abc ' +
        'Also see https://www.linkedin.com/jobs/search?currentJobId=4001234567&foo=bar'
      ) },
    },
  },
  'msg-2': {
    payload: {
      headers: [{ name: 'Subject', value: '3 new HR Coordinator jobs for you' }],
      parts: [
        { mimeType: 'text/plain', body: {} },
        { mimeType: 'text/html', body: { data: b64url(
          '<a href="https://www.linkedin.com/jobs/view/4009876543?refId=xyz">HR Coordinator</a>' +
          '<a href="https://www.linkedin.com/jobs/view/4005555555">People Ops</a>'
        ) } },
      ],
    },
  },
  'msg-3': {
    payload: {
      headers: [{ name: 'Subject', value: 'New jobs for you: Senior Sales Executive' }],
      body: { data: b64url('https://www.linkedin.com/jobs/view/4007777777') },
    },
  },
};

function mockCtx(settings = {}) {
  let callCount = 0;
  const httpStub = async (url) => {
    callCount++;
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'test-token' }), text: async () => '' };
    }
    if (url.includes('gmail.googleapis.com') && url.includes('/messages?')) {
      const messages = Object.keys(SAMPLE_MESSAGES).map(id => ({ id }));
      return { ok: true, json: async () => ({ messages }), text: async () => '' };
    }
    const idMatch = url.match(/\/messages\/(msg-\d+)/);
    if (idMatch && SAMPLE_MESSAGES[idMatch[1]]) {
      const msg = SAMPLE_MESSAGES[idMatch[1]];
      return { ok: true, json: async () => msg, text: async () => '' };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return {
    env: {
      GMAIL_CLIENT_ID:     'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
      GMAIL_REFRESH_TOKEN: 'refresh-token-test',
    },
    settings,
    fetch: httpStub,
    getCallCount: () => callCount,
  };
}

console.log('career-ops-plugin-linkedin-alerts smoke test\n');

// 1. Plugin shape
console.log('1. Plugin shape');
assert(typeof plugin === 'object',          'default export is object');
assert(typeof plugin.ingest === 'function', 'exports ingest hook');

// 2. ingest extracts jobs from emails
console.log('\n2. ingest hook — URL extraction');
const ctx  = mockCtx();
const jobs = await plugin.ingest(ctx);
assert(Array.isArray(jobs), 'returns array');
assert(jobs.length === 4,   'extracts 4 unique jobs across 3 emails (got ' + jobs.length + ')');
assert(jobs.every(j => j.title !== undefined && j.url !== undefined && j.company !== undefined), 'jobs have title/url/company');

// 3. URL normalization + dedup
console.log('\n3. URL normalization');
assert(jobs[0].url === 'https://www.linkedin.com/jobs/view/4001234567', 'normalizes comm tracking link to canonical URL');
assert(jobs.filter(j => j.url.endsWith('4001234567')).length === 1,     'dedups tracking + currentJobId forms of same job');
assert(jobs.some(j => j.url === 'https://www.linkedin.com/jobs/view/4009876543'), 'extracts URL from nested html part');

// 4. Subject parsing
console.log('\n4. Subject parsing');
assert(jobs[0].company === 'Lightspeed Commerce',        'extracts company from "X is hiring"');
assert(jobs[0].title   === 'AI Enablement Specialist',   'extracts title from "is hiring a Y"');
assert(jobs[1].title   === 'HR Coordinator',             'extracts title from "N new Y jobs for you"');
assert(jobs[1].company === '(LinkedIn)',                 'falls back to (LinkedIn) when no company in subject');

// 5. Keyword filters
console.log('\n5. Keyword filters');
const filteredCtx  = mockCtx({ excludeKeywords: ['sales'] });
const filteredJobs = await plugin.ingest(filteredCtx);
assert(filteredJobs.length === 3, 'excludeKeywords drops Sales alert (got ' + filteredJobs.length + ')');

const positiveCtx  = mockCtx({ titleKeywords: ['hr coordinator'] });
const positiveJobs = await plugin.ingest(positiveCtx);
assert(positiveJobs.length === 2, 'titleKeywords keeps only matching alerts (got ' + positiveJobs.length + ')');

// 6. OAuth flow
console.log('\n6. OAuth flow');
assert(ctx.getCallCount() >= 5, 'at least 5 http calls (token + list + 3 messages)');

console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
