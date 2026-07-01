# career-ops-plugin-gmail

Reads job alert emails from Gmail (LinkedIn alerts by default), extracts job posting URLs, and surfaces them in the career-ops pipeline.

## Setup

### 1. Get OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create a project → Enable the **Gmail API**
2. Create an OAuth 2.0 Client ID (Desktop app)
3. Download the client secret JSON

### 2. Get a refresh token

Run the one-time auth flow using your preferred OAuth tool (any OAuth2 playground works). You need:
- Scope: `https://www.googleapis.com/auth/gmail.readonly`
- Once authorized, copy the `refresh_token` from the token response

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

## Optional settings (`config/plugins.yml`)

```yaml
gmail:
  sender: jobalerts-noreply@linkedin.com  # alert sender to scan (default: LinkedIn job alerts)
  days: 7                                 # how many days back to scan (default: 7)
  maxResults: 50                          # max emails per scan (default: 50)
  titleKeywords: []                       # keep only titles containing any of these (empty = keep all)
  excludeKeywords: []                     # drop titles containing any of these
```

## How it works

The `ingest` hook:
1. Exchanges your refresh token for an access token
2. Lists emails from the alert sender within the last N days
3. Parses each subject line for job title and company ("Acme is hiring a Designer", "3 new X jobs for you", …)
4. Extracts canonical LinkedIn job URLs from the email body (tracking links and `currentJobId` forms are normalized to `linkedin.com/jobs/view/{id}` and deduplicated)
5. Applies optional title keyword filters
6. Returns `Job[]` for the career-ops pipeline — dedup against your tracker and pipeline is handled by the engine
