// Posts new arbitrage to a Telegram channel and/or Discord webhook, each linking to World with
// the invite code. Every signal is posted at most once per 24 hours.

const DEDUPE_MS = 24 * 60 * 60 * 1000;
const MAX_PER_POLL = 3;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const cents = (p) => `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`;

function eventLink(env, eventTicker) {
  const url = new URL(`https://world.xyz/event/${encodeURIComponent(eventTicker)}`);
  if (env.REFERRAL_CODE) url.searchParams.set("ref", env.REFERRAL_CODE);
  return url.toString();
}

function describe(o) {
  return o.type === "underround"
    ? `${o.outcomes} outcomes cost ${cents(o.cost)} for a $1 payout`
    : `YES + NO cost ${cents(o.cost)} for a $1 payout`;
}

export async function broadcast(env, opportunities, now = Date.now()) {
  const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID;
  const discord = env.DISCORD_WEBHOOK_URL;
  if (!telegram && !discord) return { sent: 0 };

  const minEdge = Number(env.BROADCAST_MIN_EDGE_CENTS || 1) / 100;
  const sent = (await env.KV.get("broadcasted", "json")) || {};
  for (const k of Object.keys(sent)) if (now - sent[k] > DEDUPE_MS) delete sent[k];

  const fresh = [...(opportunities.underround || []), ...(opportunities.complement || [])]
    .filter((o) => o.edge >= minEdge)
    .map((o) => ({ o, key: `${o.type}:${o.eventTicker}:${o.ticker || ""}` }))
    .filter(({ key }) => !sent[key])
    .sort((a, b) => b.o.edge - a.o.edge)
    .slice(0, MAX_PER_POLL);

  const tgBase = env.TELEGRAM_API_URL || "https://api.telegram.org";
  const store = env.EXTENSION_STORE_URL;
  let count = 0;
  for (const { o, key } of fresh) {
    const link = eventLink(env, o.eventTicker);
    const jobs = [];
    if (telegram) {
      const text = [
        `<b>Arbitrage +${cents(o.edge)} (${o.returnPct}%)</b>`,
        esc(o.title),
        esc(describe(o)),
        "",
        `<a href="${esc(link)}">Trade on World →</a>`,
        store ? `<a href="${esc(store)}">Get World Terminal</a>` : null,
        "<i>Check the market rules before trading. Not financial advice.</i>",
      ]
        .filter((l) => l !== null)
        .join("\n");
      jobs.push(
        fetch(`${tgBase}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
        }),
      );
    }
    if (discord) {
      jobs.push(
        fetch(discord, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "World Terminal",
            embeds: [
              {
                title: `Arbitrage +${cents(o.edge)} (${o.returnPct}%)`,
                url: link,
                description: `**${o.title}**\n${describe(o)}\n\n[Trade on World →](${link})${store ? ` · [Get World Terminal](${store})` : ""}`,
                color: 0x3dd68c,
                footer: { text: "Check the market rules before trading. Not financial advice." },
              },
            ],
          }),
        }),
      );
    }
    const results = await Promise.allSettled(jobs);
    if (results.some((r) => r.status === "fulfilled" && r.value.ok)) {
      sent[key] = now;
      count++;
    }
  }
  if (count) await env.KV.put("broadcasted", JSON.stringify(sent));
  return { sent: count };
}
