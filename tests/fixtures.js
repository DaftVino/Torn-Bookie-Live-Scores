'use strict';

// Deterministic sample data shaped like the real Torn bookie + provider payloads.
// Timestamps are expressed in UTC so tests do not depend on the host timezone.

const SEC = ts => Math.floor(ts / 1000);

// A fixed reference "now" used across tests: 2026-06-20T12:00:00Z
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);

// Torn bookie API response (sid=bookieApi) with a "your-bets" box.
function bookieData() {
  return {
    gameBoxesList: [
      { alias: 'other-box', matches: [{ ID: 99 }] },
      {
        alias: 'your-bets',
        matches: [
          {
            ID: 101,
            sport: 'Baseball',
            stage: 'MLB',
            competition: 'MLB',
            status: 'inprogress',
            status_desc: 'In Progress',
            name: 'Red Sox vs Yankees',
            ep: [{ name: 'Boston Red Sox' }, { name: 'New York Yankees' }],
            startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)),
            startTime: '18:00',
            bets: [{ amount: 1000 }, { amount: 2500 }]
          },
          {
            ID: 102,
            sport: 'Tennis',
            stage: 'ATP',
            competition: 'Wimbledon',
            status: 'notstarted',
            name: 'Alcaraz vs Djokovic',
            ep: [{ name: 'Carlos Alcaraz' }, { name: 'Novak Djokovic' }],
            startTimestamp: SEC(Date.UTC(2026, 5, 21, 13, 0, 0)),
            bets: [{ amount: 500 }]
          },
          {
            ID: 103,
            sport: 'Counter-Strike',
            stage: 'BLAST',
            competition: 'BLAST Premier',
            status: 'inprogress',
            name: 'NaVi vs FaZe',
            ep: [{ name: 'Natus Vincere' }, { name: 'FaZe Clan' }],
            startTimestamp: SEC(Date.UTC(2026, 5, 20, 16, 0, 0)),
            bets: [{ amount: 750 }]
          },
          {
            ID: 104,
            sport: 'Horse Racing',
            alias: 'horse-racing',
            status: 'inprogress',
            name: 'Race 5',
            ep: [{ name: 'Horse A' }, { name: 'Horse B' }],
            startTimestamp: SEC(Date.UTC(2026, 5, 20, 17, 0, 0)),
            bets: [{ amount: 100 }]
          }
        ]
      }
    ]
  };
}

// A single Odds API event snapshot (decimal odds) with two books per market.
function oddsEvent() {
  return {
    home_team: 'Boston Red Sox',
    away_team: 'New York Yankees',
    bookmakers: [
      {
        key: 'fanduel', title: 'FanDuel',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Boston Red Sox', price: 1.91 }, { name: 'New York Yankees', price: 2.00 }] },
          { key: 'spreads', outcomes: [{ name: 'Boston Red Sox', price: 1.95, point: -1.5 }, { name: 'New York Yankees', price: 1.87, point: 1.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: 1.90, point: 8.5 }, { name: 'Under', price: 1.92, point: 8.5 }] }
        ]
      },
      {
        key: 'draftkings', title: 'DraftKings',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Boston Red Sox', price: 1.95 }, { name: 'New York Yankees', price: 1.95 }] },
          { key: 'spreads', outcomes: [{ name: 'Boston Red Sox', price: 1.91, point: -1.5 }, { name: 'New York Yankees', price: 1.91, point: 1.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: 1.95, point: 8.5 }, { name: 'Under', price: 1.88, point: 8.5 }] }
        ]
      }
    ]
  };
}

// A normalized bet match (output shape of normalizeBetMatch) for matching tests.
function liveMatch(overrides = {}) {
  return Object.assign({
    tornId: 101,
    team1: 'Boston Red Sox',
    team2: 'New York Yankees',
    sport: 'Baseball',
    sportKey: 'baseball',
    sportLabel: 'Baseball',
    league: 'MLB',
    stage: 'MLB',
    competition: 'MLB',
    sectionType: 'live',
    status: 'inprogress',
    rawStatus: 'inprogress',
    startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0))
  }, overrides);
}

module.exports = { SEC, NOW, bookieData, oddsEvent, liveMatch };
