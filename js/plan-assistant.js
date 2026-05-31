import { answerQuestion, formatAssistantReply } from "./assistant.js";
import { chatCompletion, buildPlanSystemPrompt, getOpenAiApiKey } from "./ai-client.js";
import { sessionLevelLabel } from "./session-rating.js";

/**
 * @param {string} question
 * @param {object} ctx
 */
export async function answerPlanQuestion(question, ctx) {
  const q = question.trim();
  if (!q) return "Ask a question about your plan  ·  e.g. which day is best, or is Saturday gusty?";

  if (getOpenAiApiKey() && ctx.planContext) {
    try {
      const messages = [
        { role: "system", content: buildPlanSystemPrompt(ctx.planContext) },
        { role: "user", content: q },
      ];
      const reply = await chatCompletion(messages);
      return reply;
    } catch (e) {
      if (e.message !== "NO_API_KEY") {
        return `AI unavailable (${e.message}). Here's a local answer:\n\n${answerPlanLocal(q, ctx)}`;
      }
    }
  }

  return answerPlanLocal(q, ctx);
}

/**
 * @param {string} q
 * @param {object} ctx
 */
function answerPlanLocal(q, ctx) {
  const { plans, spot, profiles } = ctx;
  if (!plans?.length) {
    return "Run **Plan sessions** first, then ask about a day, wind, or whether to go.";
  }

  const lower = q.toLowerCase();
  const plan = plans[0];

  if (/best|which day|when should|go out/.test(lower)) {
    const go = plan.days.filter((d) => d.dayVerdict === "go");
    const poss = plan.days.filter((d) => d.dayVerdict === "possible");
    if (go.length) {
      return `Best pick for **${plan.profileName}** at **${spot?.name ?? "your spot"}**: ${go.map((d) => `${d.dateLabel} (${sessionLevelLabel(d.dayVerdict)})  ·  ${d.headline}`).join("; ")}.`;
    }
    if (poss.length) {
      return `No solid **GO** days; **Possible**: ${poss.map((d) => d.dateLabel).join(", ")}. Check gusts and tide windows in each day’s notes.`;
    }
    return "No strong days in the dates selected.";
  }

  if (/gust|gusting|37|strong/.test(lower)) {
    const gusty = plan.days.filter((d) =>
      /gust/i.test(d.headline) || /gust/i.test(d.suitabilityBlurb)
    );
    if (gusty.length) {
      return `Gusty periods: ${gusty.map((d) => `${d.dateLabel}: ${d.headline}`).join(" · ")}. Size down vs the average wind.`;
    }
    return "Forecast doesn’t flag extreme gusts in your window  ·  still check the hourly timeline.";
  }

  if (/past session|calibration|last time|compared/.test(lower)) {
    const withRec = plan.days.find((d) => d.recommendation);
    if (withRec?.recommendation) {
      return `Use **Compare to past sessions** on a day card (shows 3 closest logged sessions). Example: ${withRec.dateLabel}  ·  ride ${withRec.recommendation.windowLabel}, avg ${withRec.recommendation.avgWind} kt.`;
    }
    return "Log sessions under **Sessions** (spot, date, wind, kite, how it felt) then re-plan, or pick a session in **Compare to past session**.";
  }

  const profile = profiles?.[0];
  if (profile) {
    return answerQuestion(q, {
      conditions: null,
      profile,
      analysis: null,
      spot,
      allProfiles: profiles,
    });
  }

  const days = plan.days.map((d) => `${d.dateLabel}: ${d.recommendation?.verdict ?? d.dayVerdict}`).join("; ");
  return `${days}\n\nAsk about a specific day, gusts, or tides. Use **Compare to past sessions** on each day card. Optional OpenAI key under Plan → Options.`;
}

export { formatAssistantReply };
