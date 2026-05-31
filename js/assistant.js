import { getAbilityLabel, normalizeAbility } from "./ability-levels.js";
import { sessionLevelLabel } from "./session-rating.js";
import { getCalibrationAtWind } from "./calibration.js";
import { getKiteWindRange, BOARD_TYPE_LABELS } from "./engine.js";
import { assessJumpability } from "./jump-advice.js";
import { DATA_SOURCES } from "./data-sources.js";

/**
 * @param {import('./engine.js').Conditions} conditions
 * @param {import('./storage.js').RiderProfile} profile
 * @param {ReturnType<import('./engine.js').analyze>} analysis
 */
export function explainRecommendation(conditions, profile, analysis) {
  const { suitability, kiteRec, boardRec } = analysis;
  const cal = getCalibrationAtWind(conditions.windSpeed, profile.calibration);
  const steps = [];

  steps.push({
    title: "1. Session suitability (go / no-go)",
    text: buildSuitabilityExplanation(conditions, profile, suitability, cal, analysis),
  });

  if (kiteRec) {
    steps.push({
      title: "2. Kite choice",
      text: buildKiteExplanation(conditions, profile, kiteRec, cal),
    });
  }

  if (boardRec) {
    steps.push({
      title: "3. Board choice",
      text: buildBoardExplanation(conditions, boardRec),
    });
  }

  steps.push({
    title: "Data sources used",
    bullets: DATA_SOURCES.map((d) => `${d.title}: ${d.source}`),
  });

  return steps;
}

function buildSuitabilityExplanation(conditions, profile, suitability, cal, analysis) {
  const parts = [];
  parts.push(
    `Starting score 100, then adjusted for wind ${conditions.windSpeed} kt against your ability band (~${suitability.limits.minWind}-${suitability.limits.maxWind} kt for ${getAbilityLabel(conditions.skillLevel)}). These bands are app-defined guidelines, not from an external authority.`
  );

  if (conditions.gustSpeed) {
    parts.push(
      `Gust spread of ${conditions.gustSpeed - conditions.windSpeed} kt checked against your max gust tolerance (~${suitability.limits.maxGustSpread} kt).`
    );
  }

  if (cal.matchingEntries.length) {
    parts.push(
      `Calibration boost: you've logged ${cal.matchingEntries.length} session(s) near this wind.`
    );
  }

  if (analysisSpotNote(analysis)) {
    parts.push(analysisSpotNote(analysis));
  }

  parts.push(`Final suitability: ${suitability.score}/100 → ${suitability.verdict}.`);
  return parts.join(" ");
}

function analysisSpotNote(analysis) {
  if (!analysis?.spotEval) return "";
  return `Spot constraints applied (launch direction, tides, local knowledge).`;
}

function buildKiteExplanation(conditions, profile, kiteRec, cal) {
  const k = kiteRec.kite;
  const range = kiteRec.range;
  const parts = [];

  parts.push(`Each kite scored 0-100 for ${conditions.windSpeed} kt.`);

  if (k.specsSource === "manufacturer") {
    parts.push(
      `${k.name}: catalog range ${range.min}-${range.max} kt (ideal ${range.ideal} kt), adjusted for ${profile.weight} kg.`
    );
  } else {
    parts.push(`${k.name}: estimated range from size formula.`);
  }

  if (cal.preferredSize != null) {
    parts.push(`Calibration suggests ~${cal.preferredSize}m near this wind (${cal.confidence} confidence).`);
  }

  parts.push(`Winner: ${k.name} (${kiteRec.score}% match).`);
  return parts.join(" ");
}

function buildBoardExplanation(conditions, boardRec) {
  const b = boardRec.board;
  return `${BOARD_TYPE_LABELS[b.type]} selected for ${conditions.waterType} water at ${conditions.windSpeed} kt. ${boardRec.reason}`;
}

/**
 * @param {string} question
 * @param {object} ctx
 */
export function answerQuestion(question, ctx) {
  const q = question.toLowerCase().trim();
  const { conditions, profile, analysis, allProfiles, spot, tides, windSource } = ctx;

  if (!q) {
    return "Ask me anything  ·  e.g. **Will I be able to jump?**, **Should I go out?**, **Why this kite?**, or **Where does this data come from?**";
  }

  // --- Contextual: needs analysis ---
  if (analysis && conditions && profile) {
    if (/jump|jumping|jumps|pop|air time|airtime|trick|tricks|backroll|front roll|kiteloop|loop/.test(q)) {
      const jump = assessJumpability(
        conditions.windSpeed,
        conditions.gustSpeed,
        conditions.waterType,
        profile.ability,
        analysis.suitability
      );
      return `**Jumping at ${conditions.windSpeed} kt (${getAbilityLabel(profile.ability)}):**\n\n${jump.explanation}`;
    }

    if (/will i|can i|am i able|could i|able to/.test(q)) {
      if (/jump|pop|air|trick/.test(q)) {
        const jump = assessJumpability(
          conditions.windSpeed,
          conditions.gustSpeed,
          conditions.waterType,
          profile.ability,
          analysis.suitability
        );
        return jump.explanation;
      }
      if (/ride|go out|session|kite|launch/.test(q)) {
        return answerGoOut(analysis, conditions, profile, spot);
      }
    }

    if (/safe|go out|should i|worth it|ride today|session today/.test(q)) {
      return answerGoOut(analysis, conditions, profile, spot);
    }

    if (/which kite|what kite|why.*kite|kite size/.test(q) && analysis.kiteRec) {
      const k = analysis.kiteRec.kite;
      const r = analysis.kiteRec.range;
      return (
        `For **${profile.name}** at ${conditions.windSpeed} kt: **${k.name}** (${k.size}m).\n\n` +
        `Range ${r.min}-${r.max} kt (ideal ${r.ideal} kt). ${analysis.kiteRec.reason}`
      );
    }

    if (/recommend|how.*work|why.*pick|explain|algorithm|score|data source|where.*from/.test(q)) {
      const steps = explainRecommendation(conditions, profile, analysis);
      return (
        "**How this recommendation works:**\n\n" +
        steps.map((s) => `**${s.title}**\n${s.text || s.bullets?.map((b) => `• ${b}`).join("\n")}`).join("\n\n")
      );
    }
  }

  // --- No analysis yet but contextual-ish ---
  if (/jump|jumping/.test(q) && !analysis) {
    return "Run **Analyse conditions** first (pick a rider and wind), then ask again  ·  I'll use your ability level and the wind to answer.";
  }

  if (/data source|where.*data|where.*from|ability.*from|who decided|how do you know/.test(q)) {
    return (
      "**Where the data comes from:**\n\n" +
      DATA_SOURCES.map((d) => `**${d.title}**  ·  ${d.source}. ${d.detail}`).join("\n\n")
    );
  }

  if (/14|light wind|borderline|marginal|unsure/.test(q) && conditions && profile) {
    const cal = getCalibrationAtWind(conditions.windSpeed, profile.calibration);
    let msg = `At **${conditions.windSpeed} kt**, light-wind sessions are uncertain. `;
    if (cal.preferredSize) {
      msg += `Your calibration suggests **~${cal.preferredSize}m** (${cal.confidence} confidence).`;
    } else {
      msg += "Log sessions in Riders → Past sessions to personalise this.";
    }
    msg += "\n\nGive it 10-15 minutes on the water before swapping kites.";
    return msg;
  }

  if (/calibrat|history|session/.test(q) && profile) {
    return `**Past sessions**  ·  log spot, date, wind, kite, and how it felt under Riders → Past sessions.\n\n**${profile.name}** has ${profile.calibration.length} session(s) logged.`;
  }

  if (/live wind|open-?meteo|fetch wind|forecast|accura/.test(q)) {
    return (
      "**Live wind** uses **Open-Meteo**. Your spot **pin can be exact** (drag the map or use GPS). In the UK we use the **Met Office ~2 km model**; elsewhere ~11 km.\n\n" +
      "That's good for session planning but won't catch every micro-gust at the launch  ·  Windguru station data is finer if you have it.\n\n" +
      (windSource ? `Last fetch: ${windSource}.` : "Save a spot, drag the pin to your launch, then **Fetch live wind** on Analyse.")
    );
  }

  if (/tide|tides/.test(q)) {
    let msg =
      "**Tides:** US spots use **NOAA** (official station). Everywhere else uses **Open-Meteo Marine**  ·  free, global, no API key. Click **Refresh tides** on your spot.\n\n";
    if (tides?.source && tides.source !== "none") msg += `Current (${tides.source}): ${tides.summary}`;
    else if (spot) msg += `Select **${spot.name}** and click **Refresh tides** on the Spots tab.`;
    return msg;
  }

  if (/spot|launch|offshore|onshore|direction/.test(q)) {
    if (spot) {
      return (
        `**${spot.name}:** safe directions ${spot.safeDirections.join(", ")}; offshore ${spot.offshoreDirections.join(", ")}.\n\n` +
        (spot.localKnowledge ? `Local knowledge: ${spot.localKnowledge}` : "Add local knowledge in Spots to refine warnings.")
      );
    }
    return "Save a spot under the **Spots** tab with safe/offshore wind directions and local knowledge.";
  }

  if (/windguru/.test(q)) {
    return (
      "**Windguru** is excellent for kitesurfing but has no free public API. This app uses **Open-Meteo** for live wind instead. " +
      "Windguru PRO offers API access if you need station-level forecasts later."
    );
  }

  if (/profile|quiver|who/.test(q) && profile) {
    const names = allProfiles?.map((p) => p.name).join(", ") ?? profile.name;
    return `Analysing: **${profile.name}**. All riders: ${names}.`;
  }

  if (/tomorrow|weekend|forecast|plan|when.*best|best time/.test(q)) {
    return "Use the **Plan** tab: select your spot and days, then **Plan sessions**. You'll get **GO** / Possible / Maybe / Probably not / Skip per day, a full-day hourly timeline, wind summary, and on-water notes.";
  }

  if (!analysis) {
    return "Use **Plan** for tomorrow or the weekend, or **Now** for current conditions  ·  then ask about jumping, going out, or kite choice.";
  }

  return answerGoOut(analysis, conditions, profile, spot);
}

function answerGoOut(analysis, conditions, profile, spot) {
  const level = analysis.sessionLevel ?? "maybe";
  const label = sessionLevelLabel(level);
  let msg = `**${profile.name}** at **${conditions.windSpeed} kt** (${getAbilityLabel(profile.ability)}): **${label}** (${analysis.suitability.score}/100).\n\n`;

  if (level === "go") {
    msg += "Solid conditions  ·  good time to ride. ";
    if (analysis.kiteRec) msg += `Rig **${analysis.kiteRec.kite.name}**. `;
  } else if (level === "possible") {
    msg += "Worth heading to the beach if tides and direction look right. ";
    if (analysis.kiteRec) msg += `Try **${analysis.kiteRec.kite.name}**. `;
  } else if (level === "maybe") {
    msg += "Borderline  ·  experienced riders may go out with a conservative kite; beginners should wait. ";
  } else if (level === "probably-not") {
    msg += "Probably not worth it unless you're desperate for a short window. ";
  } else {
    msg += "Not recommended today. ";
  }

  if (spot && analysis.spotEval) {
    if (!analysis.spotEval.launchOk) {
      msg += `\n\n**Spot warning:** launch not advised at ${spot.name} (${conditions.windDirection} wind).`;
    } else if (analysis.spotEval.windOffshore) {
      msg += `\n\n**Offshore** for ${spot.name} (${conditions.windDirection})  ·  from directions you marked on the spot, not auto-detected from the map.`;
    }
    if (analysis.spotEval.tideLaunchRuleActive && !analysis.spotEval.tideAccessOk) {
      msg += `\n\n**Tide launch window:** ${analysis.spotEval.tideLaunchNote || "outside your set window now."}`;
    }
  }

  if (analysis.suitability.notes.length) {
    msg += "\n\n" + analysis.suitability.notes.slice(0, 4).join("\n");
  }

  return msg;
}

export function formatAssistantReply(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/```([\s\S]*?)```/g, "<pre>$1</pre>")
    .replace(/\n/g, "<br>");
}

export { DATA_SOURCES };
