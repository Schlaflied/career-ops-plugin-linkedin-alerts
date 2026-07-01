# career-ops-plugin-gmail

A [career-ops](https://github.com/santifer/career-ops) community plugin that reads job alert emails from your Gmail (LinkedIn job alerts by default), extracts job posting URLs, and surfaces them in the career-ops pipeline.

## What it does

- Exchanges your OAuth refresh token for a short-lived access token (no SDK, pure REST)
- Lists alert emails from the configured sender for the last 7 days (configurable)
- Parses subject lines for job title and company ("Acme is hiring a Designer", "3 new X jobs for you", …)
- Extracts canonical LinkedIn job URLs from email bodies — tracking links and `?currentJobId=` forms are normalized to `linkedin.com/jobs/view/{id}` and deduplicated
- Optional title keyword filters (include / exclude lists)
- Returns `Job[]` for the career-ops `ingest` hook

## Install

```bash
node plugins.mjs install https://github.com/Schlaflied/career-ops-plugin-gmail
```

## Setup

### 1. Google Cloud Console

1. Create a project (or use an existing one)
2. Enable the **Gmail API**
3. Create an **OAuth 2.0 Client ID** — type: Desktop app
4. Note your `client_id` and `client_secret`

### 2. Get a refresh token

Use any OAuth2 playground or auth flow with scope:
```
https://www.googleapis.com/auth/gmail.readonly
```
Copy the `refresh_token` from the token response.

### 3. Add to `.env`

```
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
```

### 4. Enable

```bash
node plugins.mjs enable gmail --confirm
```

## Optional config (`config/plugins.yml`)

```yaml
gmail:
  sender: jobalerts-noreply@linkedin.com  # alert sender to scan
  days: 7                                 # look-back window in days (default: 7)
  maxResults: 50                          # max emails per scan (default: 50)
  titleKeywords: []                       # keep only titles containing any of these (empty = keep all)
  excludeKeywords: ["junior", "intern"]   # drop titles containing any of these
```

## Privacy

All API calls go through `ctx.fetch` and are limited to `oauth2.googleapis.com` and `gmail.googleapis.com`. Read-only Gmail scope. No data leaves your machine to any third-party service. Credentials stay in your local `.env`.

## License

MIT
