/**
 * Quick smoke checks before deploy — run: node scripts/smoke-check.mjs
 */
import { buildRiderKiteDisplayHtml } from "../js/fair-kite-allocation.js";

function assertNoUndefined(html, label) {
  if (!html || html.includes("undefined")) {
    throw new Error(`${label}: HTML missing or contains "undefined"`);
  }
}

const assign = {
  profileId: "p1",
  name: "Fred",
  kite: { id: "k1", name: "Evo 8m", size: 8 },
  score: 72,
  soloPick: { id: "k2", name: "Dice 9m", size: 9 },
};
const crew = [
  {
    profileId: "p2",
    name: "Sam",
    kite: { id: "k2", name: "Dice 9m", size: 9 },
    score: 70,
    soloPick: null,
  },
];

const r = buildRiderKiteDisplayHtml(assign, null, 22, crew);
assertNoUndefined(r?.html, "crew assign");
if (!r.html.includes("Sam")) {
  throw new Error("expected ideal-taken copy to reference other rider");
}

const unassigned = {
  profileId: "p3",
  name: "Harry",
  reason: "shortage",
  message: "No kite",
  soloPick: { id: "k2", name: "Dice 9m", size: 9 },
  soloTakenBy: "Sam",
  takenKiteName: "Dice 9m",
};
const u = buildRiderKiteDisplayHtml(null, unassigned, 18, crew);
assertNoUndefined(u?.html, "unassigned");

console.log("smoke-check: ok");
