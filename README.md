# Zizou TV v2

A black-and-orange football fixtures site using:
- football-data.org API v4 for fixtures, team crests, scores and statuses.
- Firebase Authentication for the existing admin login.
- Firebase Realtime Database for stream embeds mapped to football-data.org match IDs.
- Node.js / Express backend to keep the football-data.org token private.

## Included competitions (Free tier)
- Champions League: `CL`
- Premier League: `PL`
- La Liga: `PD`
- Bundesliga: `BL1`
- Serie A: `SA`
- Ligue 1: `FL1`

The football-data.org Free tier has delayed scores/schedules and a 10 requests/minute limit. The server caches each date response for 60 seconds.

## Requirements
- Node.js 18 or newer
- Your football-data.org API token
- Your existing Firebase project and admin account

## Setup
1. Extract this ZIP.
2. Rename `.env.example` to `.env`.
3. Put your football-data.org token after `FOOTBALL_DATA_TOKEN=`.
4. Open a terminal in the project folder and run:

   ```bash
   npm install
   npm start
   ```

5. Open `http://localhost:3000`.

Do not put the football-data.org token in any file inside `public/` or in browser JavaScript.

## Firebase database structure

Stream codes are stored at:

```text
streams
  123456
    embedCode: "<iframe src=\"https://...\" allowfullscreen></iframe>"
    updatedAt: 1790000000000
```

The numeric child key is the football-data.org match ID. That makes the stream stay attached to the correct fixture.

## IMPORTANT: Firebase Security Rules

The old site treated any successfully authenticated Firebase user as an admin. Before deploying, restrict writes to the Realtime Database to your own admin UID. In Firebase Console → Authentication, open your admin user and copy its UID. Replace `YOUR_ADMIN_UID` below with that UID.

Example rules (preserve any other rules you already need):

```json
{
  "rules": {
    "streams": {
      ".read": true,
      "$matchId": {
        ".write": "auth != null && auth.uid === 'YOUR_ADMIN_UID'"
      }
    }
  }
}
```

If your database contains other paths, merge these rules carefully instead of overwriting unrelated rules.

## Embed code behavior

The admin field accepts an iframe embed snippet. The watch page extracts only its `src` and creates an iframe; it does not execute pasted scripts or arbitrary HTML. The embed provider must permit iframe embedding. Only use streams and embeds you are authorized to use.

## Deploying

Deploy the Node.js server to a Node-compatible host. Set `FOOTBALL_DATA_TOKEN` and `PORT` in the host's environment variables. Do not upload `.env` to a public repository.

The Firebase web config in `public/app-config.js` is client-side configuration; Firebase Security Rules are what protect database data.
