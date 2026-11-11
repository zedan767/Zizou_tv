
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_BASE = "https://api.football-data.org/v4";

const COMPETITIONS = [
  { code: "CL", name: "UEFA Champions League" },
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" }
];

const matchCache = new Map();
const diagnosticsCache = new Map();

const MATCH_CACHE_MS = 60 * 1000;
const DIAGNOSTICS_CACHE_MS = 5 * 60 * 1000;

function getDate(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return value;
}

function formatMatch(match) {
  const fullTime = match.score?.fullTime || {};
  const halfTime = match.score?.halfTime || {};

  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,
    minute: match.minute ?? null,
    matchday: match.matchday ?? null,
    stage: match.stage ?? null,

    competition: {
      code: match.competition?.code,
      name: match.competition?.name,
      emblem: match.competition?.emblem
    },

    homeTeam: {
      id: match.homeTeam?.id,
      name: match.homeTeam?.name,
      shortName: match.homeTeam?.shortName,
      crest: match.homeTeam?.crest
    },

    awayTeam: {
      id: match.awayTeam?.id,
      name: match.awayTeam?.name,
      shortName: match.awayTeam?.shortName,
      crest: match.awayTeam?.crest
    },

    score: {
      home: fullTime.home ?? halfTime.home ?? null,
      away: fullTime.away ?? halfTime.away ?? null
    }
  };
}

async function fetchCompetition(competition, date) {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  const url = new URL(
    `${API_BASE}/competitions/${competition.code}/matches`
  );

  url.searchParams.set("dateFrom", date);
  url.searchParams.set("dateTo", date);

  try {
    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": token
      }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        code: competition.code,
        name: competition.name,
        ok: false,
        httpStatus: response.status,
        count: 0,
        matches: [],
        error:
          body.message ||
          body.error ||
          `Football API returned HTTP ${response.status}`
      };
    }

    return {
      code: competition.code,
      name: competition.name,
      ok: true,
      httpStatus: response.status,
      count: body.matches?.length || 0,
      matches: body.matches || [],
      error: null
    };
  } catch (error) {
    return {
      code: competition.code,
      name: competition.name,
      ok: false,
      httpStatus: null,
      count: 0,
      matches: [],
      error: error.message
    };
  }
}

async function fetchAllCompetitions(date) {
  const results = [];
  let rateLimited = false;

  // Sequential requests help avoid the provider's rate limit.
  for (const competition of COMPETITIONS) {
    if (rateLimited) {
      results.push({
        code: competition.code,
        name: competition.name,
        ok: false,
        httpStatus: 429,
        count: 0,
        matches: [],
        error: "Skipped because the API rate limit was reached."
      });
      continue;
    }

    const result = await fetchCompetition(competition, date);
    results.push(result);

    if (result.httpStatus === 429) {
      rateLimited = true;
    }
  }

  return results;
}

function combineMatches(results) {
  const uniqueMatches = new Map();

  for (const result of results) {
    for (const match of result.matches || []) {
      uniqueMatches.set(match.id, formatMatch(match));
    }
  }

  return [...uniqueMatches.values()].sort(
    (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    tokenConfigured: Boolean(process.env.FOOTBALL_DATA_TOKEN),
    provider: "football-data.org",
    apiVersion: "v4",
    competitions: COMPETITIONS.map(item => item.code)
  });
});

app.get("/api/matches", async (req, res) => {
  const date = getDate(req.query.date);

  if (!date) {
    return res.status(400).json({
      error: "Invalid date. Use YYYY-MM-DD."
    });
  }

  if (!process.env.FOOTBALL_DATA_TOKEN) {
    return res.status(503).json({
      error: "FOOTBALL_DATA_TOKEN is missing from your .env file."
    });
  }

  const cached = matchCache.get(date);

  if (cached && Date.now() - cached.timestamp < MATCH_CACHE_MS) {
    return res.json({
      ...cached.data,
      cached: true
    });
  }

  try {
    const results = await fetchAllCompetitions(date);
    const matches = combineMatches(results);

    const failedCompetitions = results
      .filter(result => !result.ok)
      .map(result => ({
        code: result.code,
        error: result.error,
        httpStatus: result.httpStatus
      }));

    const data = {
      date,
      competitions: results.map(result => ({
        code: result.code,
        name: result.name,
        count: result.count,
        ok: result.ok
      })),
      count: matches.length,
      matches,
      failedCompetitions,
      notice: failedCompetitions.length
        ? "Some competitions could not be loaded. Check the diagnostics endpoint."
        : null
    };

    matchCache.set(date, {
      timestamp: Date.now(),
      data
    });

    return res.json({
      ...data,
      cached: false
    });
  } catch (error) {
    console.error("Matches error:", error);

    return res.status(500).json({
      error: "Could not load matches.",
      details: error.message
    });
  }
});

app.get("/api/diagnostics", async (req, res) => {
  const date = getDate(req.query.date);

  if (!date) {
    return res.status(400).json({
      error: "Invalid date. Use YYYY-MM-DD."
    });
  }

  if (!process.env.FOOTBALL_DATA_TOKEN) {
    return res.status(503).json({
      error: "FOOTBALL_DATA_TOKEN is missing from your .env file."
    });
  }

  const cached = diagnosticsCache.get(date);

  if (
    cached &&
    Date.now() - cached.timestamp < DIAGNOSTICS_CACHE_MS
  ) {
    return res.json({
      ...cached.data,
      cached: true
    });
  }

  try {
    const results = await fetchAllCompetitions(date);

    const data = {
      date,
      provider: "football-data.org",
      totalMatches: results.reduce(
        (sum, result) => sum + result.count,
        0
      ),
      competitions: results.map(result => ({
        code: result.code,
        name: result.name,
        httpStatus: result.httpStatus,
        count: result.count,
        ok: result.ok,
        error: result.error,
        matches: result.matches.map(match => ({
          id: match.id,
          homeTeam: match.homeTeam?.name,
          awayTeam: match.awayTeam?.name,
          utcDate: match.utcDate,
          status: match.status
        }))
      }))
    };

    diagnosticsCache.set(date, {
      timestamp: Date.now(),
      data
    });

    return res.json({
      ...data,
      cached: false
    });
  } catch (error) {
    console.error("Diagnostics error:", error);

    return res.status(500).json({
      error: "Diagnostics failed.",
      details: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found."
  });
});

app.listen(PORT, () => {
  console.log(`Zizou TV running at http://localhost:${PORT}`);
});
