// ============================================================
// index.js — Part 1: Imports, Setup, Command Definitions
// ============================================================
const {
Client,
GatewayIntentBits,
Partials,
EmbedBuilder,
ButtonBuilder,
ButtonStyle,
ActionRowBuilder,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ChannelType,
ChannelSelectMenuBuilder,
RoleSelectMenuBuilder,
StringSelectMenuBuilder,
StringSelectMenuOptionBuilder,
PermissionFlagsBits,
PermissionsBitField,
MessageFlags,
REST,
Routes,
SlashCommandBuilder,
AttachmentBuilder,
} = require("discord.js");
// ── Database ─────────────────────────────────────────────────
const { Pool } = require("pg");
const db = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
});
// ── Client ──────────────────────────────────────────────────
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers, // fetch members for anti-raid timeout
GatewayIntentBits.GuildModeration, // audit logs for ban/kick detection
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,

GatewayIntentBits.DirectMessages,
GatewayIntentBits.DirectMessageReactions,
GatewayIntentBits.GuildInvites, // invite tracker
],
partials: [Partials.Channel, Partials.Message],
});
// ── In-memory stores ─────────────────────────────────────────
// Active giveaways { messageId -> giveawayData }
const activeGiveaways = new Map();
// Active dork sessions { messageId -> dorkData }
const activeDorks = new Map();
// Premium guilds { guildId -> { activatedBy, activatedAt } }
const premiumGuilds = new Map();
// Activation keys { key -> { used: bool, createdAt } }
const activationKeys = new Map();
// Active application sessions { userId -> sessionData }
const activeApplications = new Map();
// Vouch store { userId -> [{ fromId, reason, timestamp }] }
const vouchStore = new Map();
// Giveaway host tracker { "guildId:userId" -> count }
const giveawayHostCounts = new Map();
// Pricing message per guild { guildId -> string } (also global key "global" for DM use)
const pricingMessages = new Map();
// Per-guild config { guildId -> { welcomeChannelId, vouchChannelId, staffAppChannelId,
// pmAppChannelId, staffRoleId, helperRoleId, pmRoleId, ticketStaffRoleId,
// spawnerBuyPrice, spawnerSellPrice, ticketTypes, staffAppQuestions, pmAppQuestions,
// appTypes: [{name, label, questions, channelId}], welcomeEnabled } }
const guildConfigs = new Map();
// Per-guild warning store { "guildId:userId" -> [{ reason, moderatorId, timestamp }] }
const warnStore = new Map();
// Scam vouch store { userId -> [{ fromId, reason, timestamp }] }
const scamVouchStore = new Map();
// Invite tracker { guildId -> { joins: [{userId, timestamp}], leaves: [{userId, timestamp}] } }
const inviteTracker = new Map();

// Partner tracking { guildId -> [{ userId, link, timestamp }] }
// Track which ticket channels already had a first response logged
const ticketResponseLogged = new Set();
// Weekly payment store { guildId -> { userId -> { status: 'completed'|'not_completed', amount: string|null, timestamp } } }
const weeklyPaymentStore = new Map();
const partnerLinks = new Map();
// Split or steal sessions { userId -> { prize, claimDeadline, giveawayChannel, resolve } }
const splitOrStealSessions = new Map();
const liveLeaderboards = new Map();
const partnerSessions = new Map();
const paymentSessions = new Map();
const giveawayValues = new Map();
const antiRaidTracker = new Map();
const antiRaidPunished = new Map();
const INVITE_REGEX_GLOBAL = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/gi;
// ============================================================
// DATABASE LAYER
// ============================================================
async function initDB() {
await db.query(`
CREATE TABLE IF NOT EXISTS guild_configs (
guild_id TEXT PRIMARY KEY,
data JSONB NOT NULL DEFAULT '{}'
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS vouch_store (
guild_id TEXT NOT NULL,
user_id TEXT NOT NULL,
data JSONB NOT NULL DEFAULT '[]',
PRIMARY KEY (guild_id, user_id)
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS scam_vouches (
user_id TEXT PRIMARY KEY,
data JSONB NOT NULL DEFAULT '[]'
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS warn_store (
guild_id TEXT NOT NULL,

user_id TEXT NOT NULL,
data JSONB NOT NULL DEFAULT '[]',
PRIMARY KEY (guild_id, user_id)
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS partner_links (
guild_id TEXT PRIMARY KEY,
data JSONB NOT NULL DEFAULT '[]'
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS premium_guilds (
guild_id TEXT PRIMARY KEY,
activated_by TEXT,
activated_at TIMESTAMPTZ DEFAULT NOW()
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS activation_keys (
key_code TEXT PRIMARY KEY,
used BOOLEAN DEFAULT FALSE,
used_by TEXT,
used_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT NOW()
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS ticket_stats (
id SERIAL PRIMARY KEY,
guild_id TEXT NOT NULL,
staff_id TEXT NOT NULL,
action TEXT NOT NULL,
ticket_channel_id TEXT,
opened_at TIMESTAMPTZ,
action_at TIMESTAMPTZ DEFAULT NOW(),
seconds_elapsed INTEGER
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS weekly_payment_store (
guild_id TEXT NOT NULL,
user_id TEXT NOT NULL,
data JSONB NOT NULL DEFAULT '{}',
PRIMARY KEY (guild_id, user_id)
)
`);

await db.query(`
CREATE TABLE IF NOT EXISTS giveaway_host_counts (
guild_id TEXT NOT NULL,
user_id TEXT NOT NULL,
data JSONB NOT NULL DEFAULT '{}',
PRIMARY KEY (guild_id, user_id)
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS pricing_messages (
key TEXT PRIMARY KEY,
text TEXT NOT NULL DEFAULT ''
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS invite_tracker (
guild_id TEXT PRIMARY KEY,
data JSONB NOT NULL DEFAULT '{}'
)
`);
await db.query(`CREATE TABLE IF NOT EXISTS partner_sessions (guild_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}')`);
await db.query(`CREATE TABLE IF NOT EXISTS giveaway_values (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}', PRIMARY KEY (guild_id, user_id))`);
await db.query(`CREATE TABLE IF NOT EXISTS active_giveaways (message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, guild_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}')`);
await db.query(`CREATE TABLE IF NOT EXISTS strikes (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '[]', PRIMARY KEY (guild_id, user_id))`);
await db.query(`CREATE TABLE IF NOT EXISTS live_leaderboards (guild_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}')`);
await db.query(`
CREATE TABLE IF NOT EXISTS bot_announcements (
id SERIAL PRIMARY KEY,
title TEXT,
message TEXT NOT NULL,
sent_by TEXT,
created_at TIMESTAMPTZ DEFAULT NOW(),
sent BOOLEAN DEFAULT FALSE,
sent_at TIMESTAMPTZ
)
`);
console.log(" Database tables ready");
}
// ── Guild Config DB helpers ───────────────────────────────────
async function dbSaveGuildConfig(guildId) {
const cfg = guildConfigs.get(guildId);
if (!cfg) return;
await db.query(
`INSERT INTO guild_configs (guild_id, data) VALUES ($1, $2)
ON CONFLICT (guild_id) DO UPDATE SET data = $2`,
[guildId, JSON.stringify(cfg)]

).catch(e => console.error("DB save guild config error:", e));
}
async function dbLoadAllGuildConfigs() {
const res = await db.query("SELECT guild_id, data FROM guild_configs").catch(() => ({ rows: [] }));
for (const row of res.rows) {
const defaults = {
welcomeEnabled: true, welcomeChannelId: null, vouchChannelId: null,
partnerChannelId: null, staffAppChannelId: null, pmAppChannelId: null,
staffRoleId: null, helperRoleId: null, pmRoleId: null, ticketStaffRoleId: null,
spawnerBuyPrice: 4400000, spawnerSellPrice: 5200000, ticketTypes: null, appTypes: null,
};
guildConfigs.set(row.guild_id, { ...defaults, ...row.data });
}
console.log(" Loaded", res.rows.length, "guild configs from DB");
}
// ── Vouch DB helpers ──────────────────────────────────────────
async function dbSaveVouch(guildId, userId) {
const data = vouchStore.get(userId) ?? [];
await db.query(
`INSERT INTO vouch_store (guild_id, user_id, data) VALUES ($1, $2, $3)
ON CONFLICT (guild_id, user_id) DO UPDATE SET data = $3`,
[guildId, userId, JSON.stringify(data)]
).catch(e => console.error("DB save vouch error:", e));
}
async function dbLoadAllVouches() {
const res = await db.query("SELECT user_id, data FROM vouch_store").catch(() => ({ rows: [] }));
for (const row of res.rows) {
vouchStore.set(row.user_id, row.data);
}
console.log(" Loaded", res.rows.length, "vouch entries from DB");
}
// ── Scam vouch DB helpers ────────────────────────────────────
async function dbSaveScamVouch(userId) {
const data = scamVouchStore.get(userId) ?? [];
await db.query(
`INSERT INTO scam_vouches (user_id, data) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET data = $2`,
[userId, JSON.stringify(data)]
).catch(e => console.error("DB save scam vouch error:", e));
}
async function dbLoadAllScamVouches() {
const res = await db.query("SELECT user_id, data FROM scam_vouches").catch(() => ({ rows: [] }));

for (const row of res.rows) {
scamVouchStore.set(row.user_id, row.data);
}
}
// ── Warn store DB helpers ────────────────────────────────────
async function dbSaveWarn(guildId, userId) {
const key = guildId + ":" + userId;
const data = warnStore.get(key) ?? [];
await db.query(
`INSERT INTO warn_store (guild_id, user_id, data) VALUES ($1, $2, $3)
ON CONFLICT (guild_id, user_id) DO UPDATE SET data = $3`,
[guildId, userId, JSON.stringify(data)]
).catch(e => console.error("DB save warn error:", e));
}
async function dbLoadAllWarns() {
const res = await db.query("SELECT guild_id, user_id, data FROM warn_store").catch(() => ({ rows: [] }));
for (const row of res.rows) {
warnStore.set(row.guild_id + ":" + row.user_id, row.data);
}
}
// ── Partner links DB helpers ─────────────────────────────────
async function dbSavePartnerLinks(guildId) {
const data = partnerLinks.get(guildId) ?? [];
await db.query(
`INSERT INTO partner_links (guild_id, data) VALUES ($1, $2)
ON CONFLICT (guild_id) DO UPDATE SET data = $2`,
[guildId, JSON.stringify(data)]
).catch(e => console.error("DB save partner links error:", e));
}
async function dbLoadAllPartnerLinks() {
const res = await db.query("SELECT guild_id, data FROM partner_links").catch(() => ({ rows: [] }));
for (const row of res.rows) {
partnerLinks.set(row.guild_id, row.data);
}
}
// ── Sponsor store DB helpers ─────────────────────────────────
async function dbSaveWeeklyPayment(guildId, userId) {
if (!weeklyPaymentStore.has(guildId)) return;
const data = weeklyPaymentStore.get(guildId).get(userId) ?? { status: 'not_completed', amount: null, timestamp: Date.now() };
await db.query(
`INSERT INTO weekly_payment_store (guild_id, user_id, data) VALUES ($1, $2, $3)
ON CONFLICT (guild_id, user_id) DO UPDATE SET data = $3`,

[guildId, userId, JSON.stringify(data)]
).catch(e => console.error("DB save weekly_payment error:", e));
}
async function dbClearWeeklyPayments(guildId) {
weeklyPaymentStore.set(guildId, new Map());
await db.query("DELETE FROM weekly_payment_store WHERE guild_id = $1", [guildId])
.catch(e => console.error("DB clear weekly_payment error:", e));
}
async function dbLoadAllWeeklyPayments() {
const res = await db.query("SELECT guild_id, user_id, data FROM weekly_payment_store").catch(() => ({ rows: [] }));
for (const row of res.rows) {
if (!weeklyPaymentStore.has(row.guild_id)) weeklyPaymentStore.set(row.guild_id, new Map());
weeklyPaymentStore.get(row.guild_id).set(row.user_id, row.data);
}
console.log("Loaded " + res.rows.length + " weekly payment entries from DB");
}
// ── Giveaway host counts DB helpers ─────────────────────────
async function dbSaveGiveawayCount(guildId, userId) {
const key = guildId + ":" + userId;
const data = giveawayHostCounts.get(key) ?? { count: 0, timestamps: [] };
await db.query(
`INSERT INTO giveaway_host_counts (guild_id, user_id, data) VALUES ($1, $2, $3)
ON CONFLICT (guild_id, user_id) DO UPDATE SET data = $3`,
[guildId, userId, JSON.stringify(data)]
).catch(e => console.error("DB save giveaway count error:", e));
}
async function dbLoadAllGiveawayCounts() {
const res = await db.query("SELECT guild_id, user_id, data FROM giveaway_host_counts").catch(() => ({ rows: [] }));
for (const row of res.rows) {
giveawayHostCounts.set(row.guild_id + ":" + row.user_id, row.data);
}
}
// ── Pricing DB helpers ───────────────────────────────────────
async function dbSavePricing(key, text) {
await db.query(
`INSERT INTO pricing_messages (key, text) VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET text = $2`,
[key, text]
).catch(e => console.error("DB save pricing error:", e));
}
async function dbLoadAllPricing() {

async function dbSaveStrike(guildId, userId, data) {
await db.query(`INSERT INTO strikes (guild_id, user_id, data) VALUES ($1,$2,$3) ON CONFLICT (guild_id, user_id) DO UPDATE SET data=$3`,[guildId,userId,JSON.stringify(data)]).catch(e=>console.error("DB strike:",e.message));
}
// ── Live leaderboards DB helpers ─────────────────────────────
async function dbSaveLiveLeaderboards(guildId) {
const data = liveLeaderboards.get(guildId) ?? {};
await db.query(
`INSERT INTO live_leaderboards (guild_id, data) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET data=$2`,
[guildId, JSON.stringify(data)]
).catch(e => console.error("DB live_leaderboards save:", e.message));
}
async function dbLoadLiveLeaderboards() {
const res = await db.query("SELECT guild_id, data FROM live_leaderboards").catch(() => ({ rows: [] }));
for (const row of res.rows) {
liveLeaderboards.set(row.guild_id, row.data);
}
console.log(" Loaded", res.rows.length, "live leaderboard configs from DB");
}
// ── Premium guilds DB helpers ─────────────────────────────────
async function dbSavePremiumGuild(guildId, activatedBy) {
await db.query(
`INSERT INTO premium_guilds (guild_id, activated_by, activated_at) VALUES ($1,$2,NOW())
ON CONFLICT (guild_id) DO UPDATE SET activated_by=$2, activated_at=NOW()`,
[guildId, activatedBy]
).catch(e => console.error("DB premium_guilds:", e.message));
}
async function dbRemovePremiumGuild(guildId) {
premiumGuilds.delete(guildId);
await db.query("DELETE FROM premium_guilds WHERE guild_id=$1", [guildId])
.catch(e => console.error("DB remove premium_guild:", e.message));
}
async function dbSaveActivationKey(key) {
await db.query(
`INSERT INTO activation_keys (key_code) VALUES ($1) ON CONFLICT DO NOTHING`,
[key]
).catch(e => console.error("DB activation_key:", e.message));
}
async function dbMarkKeyUsed(key, guildId) {
await db.query(
`UPDATE activation_keys SET used=true, used_by=$2, used_at=NOW() WHERE key_code=$1`,
[key, guildId]
).catch(e => console.error("DB key used:", e.message));
}
async function dbLogTicketStat(guildId, staffId, action, channelId, openedAt) {
const secsElapsed = openedAt ? Math.floor((Date.now() - openedAt) / 1000) : null;

await db.query(
`INSERT INTO ticket_stats (guild_id, staff_id, action, ticket_channel_id, opened_at, seconds_elapsed)
VALUES ($1,$2,$3,$4,$5,$6)`,
[guildId, staffId, action, channelId, openedAt ? new Date(openedAt) : null, secsElapsed]
).catch(e => console.error("DB ticket_stat:", e.message));
}
// ── Load everything from DB on startup ───────────────────────
async function loadAllFromDB() {
await Promise.all([
dbLoadAllGuildConfigs(),
dbLoadAllVouches(),
dbLoadAllScamVouches(),
dbLoadAllWarns(),
dbLoadAllPartnerLinks(),
dbLoadAllWeeklyPayments(),
dbLoadAllGiveawayCounts(),
dbLoadAllPricing(),
dbLoadAllInviteTracker(),
dbLoadLiveLeaderboards(),
]);
// Load premium guilds
const pgRes = await db.query("SELECT guild_id, activated_by FROM premium_guilds").catch(()=>({rows:[]}));
for (const r of pgRes.rows) premiumGuilds.set(r.guild_id, { activatedBy: r.activated_by });
// Load unused activation keys
const akRes = await db.query("SELECT key_code FROM activation_keys WHERE used=false").catch(()=>({rows:[]}));
for (const r of akRes.rows) activationKeys.set(r.key_code, { used: false });
console.log(" Loaded", pgRes.rows.length, "premium guilds,", akRes.rows.length, "activation keys");
// Load new tables
try {
const ps = await db.query("SELECT guild_id, data FROM partner_sessions").catch(()=>({rows:[]}));
for (const r of ps.rows) partnerSessions.set(r.guild_id, r.data);
const gv = await db.query("SELECT guild_id, user_id, data FROM giveaway_values").catch(()=>({rows:[]}));
for (const r of gv.rows) giveawayValues.set(r.guild_id+":"+r.user_id, r.data);
} catch(e) { console.error("loadAllFromDB new tables:", e.message); }
// Load strikes
try {
const sk = await db.query("SELECT guild_id, user_id, data FROM strikes").catch(()=>({rows:[]}));
for (const r of sk.rows) strikeStore.set(r.guild_id+":"+r.user_id, r.data);
} catch(e) { console.error("loadAllFromDB strikes:", e.message); }
// Load active giveaways and reschedule timers
try {
const ag = await db.query("SELECT message_id, channel_id, guild_id, data FROM active_giveaways").catch(()=>({rows:[]}));
let gwRestored = 0;
for (const r of ag.rows) {
const data = r.data;

activeGiveaways.set(r.message_id, data);
const remaining = data.endsAt - Date.now();
const delay = remaining > 0 ? remaining : 5000; // if expired, end after 5s
// Use fetch (not cache) so it works even if channel isn't cached yet
setTimeout(async () => {
try {
const ch = await client.channels.fetch(r.channel_id).catch(() => null);
if (!ch) { dbDeleteActiveGiveaway(r.message_id); return; }
if (data.isSplitOrSteal) await endSplitOrStealGiveaway(r.message_id, ch, data).catch(()=>{});
else await endGiveaway(r.message_id, ch).catch(()=>{});
} catch(e) { console.error("Giveaway restore error:", e.message); }
}, delay);
gwRestored++;
}
console.log(" Loaded", gwRestored, "active giveaways from DB");
} catch(e) { console.error("loadAllFromDB active_giveaways:", e.message); }
console.log(" All data loaded from database");
global._bot._dbLoaded = true;
}
// Helper: get or create guild config
function getGuildConfig(guildId) {
if (!guildId) return {
welcomeEnabled: true, welcomeChannelId: null, vouchChannelId: null,
staffAppChannelId: null, pmAppChannelId: null, staffRoleId: null,
helperRoleId: null, pmRoleId: null, ticketStaffRoleId: null,
spawnerBuyPrice: 4400000, spawnerSellPrice: 5200000,
ticketTypes: null, appTypes: null,
ticketLogsChannelId: null, announceChannelId: null,
lowestStaffRoleId: null, raidWarningsChannelId: null,
memberRoleId: null, strikeChannelId: null, promotionChannelId: null,
founderRoleId: null, founderUserIds: [], antiRaid: null,
};
if (!guildConfigs.has(guildId)) {
guildConfigs.set(guildId, {
welcomeEnabled: true,
welcomeChannelId: null, // must be set per server via /setup welcome
vouchChannelId: process.env.VOUCH_CHANNEL_ID ?? null,
partnerChannelId: null,
staffAppChannelId: process.env.STAFF_APP_CHANNEL_ID ?? null,
pmAppChannelId: process.env.PM_APP_CHANNEL_ID ?? null,
staffRoleId: process.env.STAFF_ROLE_ID ?? null,
helperRoleId: process.env.HELPER_ROLE_ID ?? null,
pmRoleId: process.env.PM_ROLE_ID ?? null,
ticketStaffRoleId: process.env.TICKET_STAFF_ROLE_ID ?? null,
spawnerBuyPrice: 4400000,
spawnerSellPrice: 5200000,

ticketTypes: null, // null = use defaults
appTypes: null, // null = use defaults
});
}
return guildConfigs.get(guildId);
}
// ── Ticket category names (must match exactly in your server) ─
const TICKET_CATEGORIES = {
support: "Support Tickets",
giveaway: "Giveaway Tickets",
partnership: "Partnership Ticket",
spawner: "Spawner Staff Ticket",
report: "Member/Staff Report",
building: "Building Ticket",
mysterybox: "Mystery Box",
};
// ── Application config ────────────────────────────────────────
const STAFF_APP_QUESTIONS = [
"How old are you?",
"What are your stats on DonutSMP?",
"What is your IGN?",
"How many giveaways can you make a week?",
"What would you do if someone was spamming racial slurs or inappropriate messages in chat?",
"Do you have any prior experience? If yes, name the servers and your role.",
];
const PM_APP_QUESTIONS = [
"What is your IGN?",
"What are your stats on DonutSMP?",
"How many partners can you make in a week?",
"Do you understand that breaking partner requirements can lead to a strike or demotion?",
"Do you have any prior experience? If yes, name the servers and your role.",
];
// ── Helper: parse number shortcuts (k / m / b) ───────────────
function parseNumber(input) {
if (input === null || input === undefined) return NaN;
const str = String(input).trim().toLowerCase().replace(/,/g, "");
const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
const match = str.match(/^(\d+(\.\d+)?)([kmb]?)$/);
if (!match) return NaN;
const num = parseFloat(match[1]);
const suffix = match[3];
return suffix ? num * multipliers[suffix] : num;
}

// ── Helper: format large numbers back to readable string ──────
function formatNumber(num) {
if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + "b";
if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.00$/, "") + "m";
if (num >= 1_000) return (num / 1_000).toFixed(2).replace(/\.00$/, "") + "k";
return num.toString();
}
// ── Helper: compact stat number (1500 -> 1.5k) ─────────────
function compactStat(n) {
const num = parseFloat(n) || 0;
if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "b";
if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "m";
if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
return String(Math.round(num));
}
// ── Helper: consistent error embed ───────────────────────────
function errorEmbed(message) {
return new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Error")
.setDescription(message)
.setTimestamp();
}
// ── Helper: consistent success embed ─────────────────────────
function successEmbed(title, description) {
return new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(title)
.setDescription(description)
.setTimestamp();
}
// ============================================================
// SLASH COMMAND DEFINITIONS
// ============================================================
const rawCommands = [
// ── WARN SYSTEM ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("warn")
.setDescription("Warn a member")

.addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for warning").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("warnings")
.setDescription("View warnings for a member")
.addUserOption(o => o.setName("user").setDescription("Member to check").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("clearwarnings")
.setDescription("Clear all warnings for a member")
.addUserOption(o => o.setName("user").setDescription("Member to clear").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
// ── SMOKER ────────────────────────────────────────────────
new SlashCommandBuilder()
.setName("smoker")
.setDescription("Calculate smoker income")
.addStringOption(o => o.setName("amount").setDescription("Number of smokers (e.g. 10, 100)").setRequired(true)),
// ── VOUCHES LEADERBOARD ───────────────────────────────────
new SlashCommandBuilder()
.setName("vouchesleaderboard")
.setDescription("Show the top vouched members")
.addIntegerOption(o => o.setName("page").setDescription("Page number").setRequired(false).setMinValue(1)),
new SlashCommandBuilder()
.setName("ban")
.setDescription("Ban a member from the server")
.addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for ban").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
new SlashCommandBuilder()
.setName("unban")
.setDescription("Unban a user by their ID")
.addStringOption(o => o.setName("userid").setDescription("User ID to unban").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for unban").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
new SlashCommandBuilder()
.setName("timeout")
.setDescription("Timeout a member")

.addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
.addStringOption(o =>
o.setName("duration")
.setDescription("Duration (e.g. 10m, 1h, 7d — max 28d)")
.setRequired(true)
)
.addStringOption(o => o.setName("reason").setDescription("Reason for timeout").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("untimeout")
.setDescription("Remove timeout from a member")
.addUserOption(o => o.setName("user").setDescription("Member to untimeout").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
// ── ROLE MANAGEMENT ──────────────────────────────────────
new SlashCommandBuilder()
.setName("addrole")
.setDescription("Add a role to a member")
.addUserOption(o => o.setName("user").setDescription("Target member").setRequired(true))
.addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
new SlashCommandBuilder()
.setName("removerole")
.setDescription("Remove a role from a member")
.addUserOption(o => o.setName("user").setDescription("Target member").setRequired(true))
.addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
// ── EMBED BUILDER ─────────────────────────────────────────
new SlashCommandBuilder()
.setName("embed")
.setDescription("Send a custom embed message")
.addStringOption(o => o.setName("title").setDescription("Embed title").setRequired(true))
.addStringOption(o => o.setName("description").setDescription("Embed description").setRequired(true))
.addStringOption(o =>
o.setName("color")
.setDescription("Hex color (e.g. #ff0000) — default: blurple")
.setRequired(false)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

// ── SPAWNER CALCULATOR ────────────────────────────────────
new SlashCommandBuilder()
.setName("spawner")
.setDescription("Calculate spawner buy or sell total")
.addStringOption(o =>
o.setName("amount")
.setDescription("Number of spawners (supports k/m/b)")
.setRequired(true)
)
.addStringOption(o =>
o.setName("type")
.setDescription("Are you buying or selling?")
.setRequired(true)
.addChoices(
{ name: "Buying (you buy from server)", value: "buy" },
{ name: "Selling (you sell to server)", value: "sell" }
)
),
// ── SPAWNER PRICE CONFIG (Admin) ──────────────────────────
new SlashCommandBuilder()
.setName("setspawnerprice")
.setDescription("Set the spawner buy or sell price (Admin only)")
.addStringOption(o =>
o.setName("type")
.setDescription("Which price to update?")
.setRequired(true)
.addChoices(
{ name: "Buy price (server pays players)", value: "buy" },
{ name: "Sell price (players pay server)", value: "sell" }
)
)
.addStringOption(o =>
o.setName("price")
.setDescription("New price (supports k/m/b, e.g. 4.4m)")
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
// ── SETUP (unified) ─────────────────────────────────────
new SlashCommandBuilder().setName("setup").setDescription("Open the bot setup panel").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName("wait").setDescription("Send the wait message"),
// ── GIVEAWAY ─────────────────────────────────────────────
new SlashCommandBuilder()

.setName("giveaway").setDescription("Start a giveaway")
.addStringOption(o=>o.setName("prize").setDescription("Prize (e.g. Elytra, 10m)").setRequired(true))
.addStringOption(o=>o.setName("duration").setDescription("Duration (e.g. 1h, 30m, 2d)").setRequired(true))
.addStringOption(o=>o.setName("description").setDescription("Extra description").setRequired(false))
.addIntegerOption(o=>o.setName("winners").setDescription("Winners (default: 1)").setRequired(false).setMinValue(1).setMaxValue(20))
.addStringOption(o=>o.setName("itemvalue").setDescription("Item value for tracking (e.g. 50m)").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
new SlashCommandBuilder()
.setName("giveawaydork").setDescription("Start a Dork giveaway — winner can double the prize")
.addStringOption(o=>o.setName("prize").setDescription("Starting prize (e.g. 5m)").setRequired(true))
.addStringOption(o=>o.setName("duration").setDescription("Duration (e.g. 1h, 30m)").setRequired(true))
.addStringOption(o=>o.setName("maxprize").setDescription("Max prize cap (e.g. 10m)").setRequired(true))
.addStringOption(o=>o.setName("description").setDescription("Extra description").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
new SlashCommandBuilder()
.setName("giveawaysos").setDescription("Start a GiveawaySoS — winners Split or Steal")
.addStringOption(o=>o.setName("prize").setDescription("Prize (e.g. 10m, Elytra)").setRequired(true))
.addStringOption(o=>o.setName("duration").setDescription("Duration (e.g. 1h, 30m)").setRequired(true))
.addIntegerOption(o=>o.setName("winners").setDescription("Winners (default: 2)").setRequired(false).setMinValue(2).setMaxValue(10))
.addStringOption(o=>o.setName("claimtime").setDescription("Time for winners to respond (default: 10m)").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
new SlashCommandBuilder()
.setName("giveawayend").setDescription("Force-end a giveaway early")
.addStringOption(o=>o.setName("messageid").setDescription("Message ID").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
new SlashCommandBuilder()
.setName("giveawaytrack").setDescription("See how many giveaways a user has hosted")
.addUserOption(o=>o.setName("user").setDescription("User (defaults to yourself)").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
new SlashCommandBuilder()
.setName("giveawayleaderboard").setDescription("See the giveaway value leaderboard")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
.setDMPermission(true),
// ── DONUT SMP: STATS ─────────────────────────────────────
new SlashCommandBuilder()
.setName("stats")
.setDescription("View a DonutSMP player's in-game stats")
.addStringOption(o =>
o.setName("username")
.setDescription("In-game username")
.setRequired(true)
)
.setDMPermission(true),
// ── DONUT SMP: LOOKUP ─────────────────────────────────────

new SlashCommandBuilder()
.setName("lookup")
.setDescription("Look up a DonutSMP player's rank and location")
.addStringOption(o =>
o.setName("username")
.setDescription("In-game username")
.setRequired(true)
)
.setDMPermission(true),
// ── DONUT SMP: AUCTION HOUSE ──────────────────────────────
new SlashCommandBuilder()
.setName("ah")
.setDescription("Search the DonutSMP Auction House for an item")
.addStringOption(o =>
o.setName("item")
.setDescription("Item name to search for (e.g. diamond, sword)")
.setRequired(true)
)
.addStringOption(o =>
o.setName("sort")
.setDescription("Sort order")
.setRequired(false)
.addChoices(
{ name: "Lowest Price", value: "lowest_price" },
{ name: "Highest Price", value: "highest_price" },
{ name: "Recently Listed", value: "recently_listed" },
{ name: "Last Listed", value: "last_listed" }
)
)
.setDMPermission(true),
// ── DONUT SMP: AUCTION TRANSACTIONS ──────────────────────
new SlashCommandBuilder()
.setName("ah-recent")
.setDescription("View recent DonutSMP Auction House sales")
.addIntegerOption(o =>
o.setName("page")
.setDescription("Page number (1–10, 100 sales per page)")
.setRequired(false)
.setMinValue(1)
.setMaxValue(10)
)
.setDMPermission(true),

// ── DONUT SMP: LEADERBOARD ───────────────────────────────
new SlashCommandBuilder()
.setName("leaderboard")
.setDescription("View DonutSMP leaderboards")
.addStringOption(o =>
o.setName("type")
.setDescription("Which leaderboard to view")
.setRequired(true)
.addChoices(
{ name: " Money", value: "money" },
{ name: " Kills", value: "kills" },
{ name: " Deaths", value: "deaths" },
{ name: " Playtime", value: "playtime" },
{ name: " Shards", value: "shards" },
{ name: " Most Sold (/sell)", value: "sell" },
{ name: " Most Spent (/shop)", value: "shop" },
{ name: " Mobs Killed", value: "mobskilled" },
{ name: " Blocks Broken", value: "brokenblocks" },
{ name: " Blocks Placed", value: "placedblocks" }
)
)
.addIntegerOption(o =>
o.setName("page")
.setDescription("Page number (default: 1)")
.setRequired(false)
.setMinValue(1)
)
.setDMPermission(true),
// ── SPAWNER PRICE SEND ───────────────────────────────────
new SlashCommandBuilder()
.setName("spawnerpricesend")
.setDescription("Post the current spawner prices in the channel")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
// ── TICKET PANEL ─────────────────────────────────────────
new SlashCommandBuilder()
.setName("ticketpanelsend")
.setDescription("Post the ticket panel in this channel")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── APPLICATION PANEL ────────────────────────────────────

new SlashCommandBuilder()
.setName("applicationpanelsend")
.setDescription("Post the staff application panel in this channel")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── VOUCH ─────────────────────────────────────────────────
new SlashCommandBuilder()
.setName("vouch")
.setDescription("Vouch for a user in this server")
.addUserOption(o =>
o.setName("user")
.setDescription("The user you are vouching for")
.setRequired(true)
)
.addStringOption(o =>
o.setName("reason")
.setDescription("Why are you vouching for them?")
.setRequired(true)
),
// ── VOUCH COUNT ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("vouchcount")
.setDescription("Check how many vouches a user has received")
.addUserOption(o =>
o.setName("user")
.setDescription("User to check (defaults to yourself)")
.setRequired(false)
),
// ── LOCK CHANNEL ──────────────────────────────────────────
new SlashCommandBuilder()
.setName("lockchannel")
.setDescription("Lock or unlock a channel so only staff can send messages")
.addStringOption(o =>
o.setName("action")
.setDescription("Lock or unlock")
.setRequired(true)
.addChoices(
{ name: "Lock", value: "lock" },
{ name: "Unlock", value: "unlock" }
)
)
.addStringOption(o =>

o.setName("reason")
.setDescription("Reason for locking")
.setRequired(false)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── EMBED ORGANIZED ───────────────────────────────────────
new SlashCommandBuilder()
.setName("embedorganized")
.setDescription("Create a customized embed using a popup form")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
// ── PURGE ─────────────────────────────────────────────────
new SlashCommandBuilder()
.setName("purge")
.setDescription("Delete a specified number of recent messages")
.addIntegerOption(o =>
o.setName("amount")
.setDescription("Number of messages to delete (1-100)")
.setRequired(true)
.setMinValue(1)
.setMaxValue(100)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
// ── TICKET RENAME ─────────────────────────────────────────
new SlashCommandBuilder()
.setName("ticketrename")
.setDescription("Rename the current ticket channel (only works inside a ticket)")
.addStringOption(o =>
o.setName("name")
.setDescription("New name for the ticket")
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── TICKET USER ADD ───────────────────────────────────────
new SlashCommandBuilder()
.setName("ticketuseradd")
.setDescription("Add a user to the current ticket")
.addUserOption(o =>
o.setName("user")
.setDescription("User to add")

.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── TICKET USER REMOVE ────────────────────────────────────
new SlashCommandBuilder()
.setName("ticketuserremove")
.setDescription("Remove a user from the current ticket")
.addUserOption(o =>
o.setName("user")
.setDescription("User to remove")
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
// ── PRICING ───────────────────────────────────────────────
new SlashCommandBuilder()
.setName("pricing")
.setDescription("View the current server pricing")
.setDMPermission(true),
// ── PRICING SET ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("pricingset")
.setDescription("Set the pricing message (Founder only)")
.setDMPermission(true),
// ── INVITE ────────────────────────────────────────────────
new SlashCommandBuilder()
.setName("invite")
.setDescription("View the server invite / pricing info")
.setDMPermission(true),
// ── SERVER ALL ────────────────────────────────────────────
new SlashCommandBuilder()
.setName("serverall")
.setDescription("List all servers the bot is in (Founder only)")
.setDMPermission(true),

new SlashCommandBuilder()
.setName("features")

.setDescription("Show all bot features")
.setDMPermission(true),
new SlashCommandBuilder()
.setName("commands")
.setDescription("Show all bot commands")
.setDMPermission(true),
// ── SLOWMODE ──────────────────────────────────────────────
new SlashCommandBuilder()
.setName("slowmode")
.setDescription("Set slowmode on a channel")
.addStringOption(o =>
o.setName("duration")
.setDescription("Duration e.g. 0, 5s, 3m, 1h (0 to disable)")
.setRequired(true)
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

// ── KICK ──────────────────────────────────────────────────
new SlashCommandBuilder()
.setName("kick")
.setDescription("Kick a member from the server")
.addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for kick").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
// ── SERVER INFO ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("serverinfo")
.setDescription("View server information"),
// ── USER INFO ─────────────────────────────────────────────
new SlashCommandBuilder()
.setName("userinfo")
.setDescription("View info about a user")
.addUserOption(o => o.setName("user").setDescription("User to check (defaults to yourself)").setRequired(false)),
// ── ROLE INFO ─────────────────────────────────────────────
new SlashCommandBuilder()

.setName("roleinfo")
.setDescription("View info about a role")
.addRoleOption(o => o.setName("role").setDescription("Role to check").setRequired(true)),
// ── INVITE TRACKER ────────────────────────────────────────
new SlashCommandBuilder()
.setName("invitetracker")
.setDescription("View join/leave stats for this server")
.addStringOption(o =>
o.setName("period")
.setDescription("Time period to check")
.setRequired(false)
.addChoices(
{ name: "Last 24 hours", value: "24h" },
{ name: "Last week", value: "week" },
{ name: "Last month", value: "month" },
{ name: "All time", value: "all" }
)
),
// ── VOUCHES LEADERBOARD ───────────────────────────────────

new SlashCommandBuilder()
.setName("scamvouch")
.setDescription("Add or remove a scam vouch for a user")
.addStringOption(o =>
o.setName("action")
.setDescription("Add or remove a scam vouch")
.setRequired(true)
.addChoices(
{ name: "Add", value: "add" },
{ name: "Remove", value: "remove" }
)
)
.addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason (required for add)").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
// ── LOCKDOWN / UNLOCKDOWN ─────────────────────────────────
new SlashCommandBuilder()
.setName("lockdown")
.setDescription("Lock all channels in the server (Founder only)"),
new SlashCommandBuilder()

.setName("unlockdown")
.setDescription("Unlock all channels in the server (Founder only)"),
// ── SETUP WELCOME ─────────────────────────────────────────

// ── SETUP VOUCH ───────────────────────────────────────────

// ── SETUP TICKETS ─────────────────────────────────────────

// ── SETUP APPLICATIONS ────────────────────────────────────

// ── SETUP ROLES ───────────────────────────────────────────

// ── SETUP VIEW ────────────────────────────────────────────
new SlashCommandBuilder()
.setName("setupview")
.setDescription("View the current bot configuration for this server")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── CLOSE TICKET ──────────────────────────────────────────
new SlashCommandBuilder()
.setName("close")
.setDescription("Close the current ticket channel"),
// ── PARTNER TRACKING ──────────────────────────────────────
new SlashCommandBuilder()
.setName("partnertracking")
.setDescription("Show the partner leaderboard — tracks Discord invite links sent in the partner channel")
.addStringOption(o =>
o.setName("period")
.setDescription("Time period (default: all time)")
.setRequired(false)
.addChoices(
{ name: "Last 7 Days", value: "week" },
{ name: "Last Month", value: "month" },
{ name: "All Time", value: "all" }
)
),

// ── GIVEAWAY TRACKING ─────────────────────────────────────
new SlashCommandBuilder()
.setName("giveawaytracking")
.setDescription("Show the giveaway host leaderboard")
.addStringOption(o =>
o.setName("period")
.setDescription("Time period (default: all time)")
.setRequired(false)
.addChoices(
{ name: "Last 7 Days", value: "week" },
{ name: "Last Month", value: "month" },
{ name: "All Time", value: "all" }
)
),
new SlashCommandBuilder()
.setName("vouchleaderboard")
.setDescription("Show the vouch leaderboard from most to least")
.addStringOption(o =>
o.setName("period")
.setDescription("Time period (default: all time)")
.setRequired(false)
.addChoices(
{ name: "Last 7 Days", value: "week" },
{ name: "Last Month", value: "month" },
{ name: "All Time", value: "all" }
)
),
// ── SETUP CHANNELS ────────────────────────────────────────

// ── GIVEAWAY SPLIT OR STEAL ───────────────────────────────

// ── WEEKLY PAYMENT ────────────────────────────────────────
new SlashCommandBuilder()
.setName("weeklypayment")
.setDescription("Track weekly payments for users")
.addUserOption(o => o.setName("user").setDescription("The user to mark").setRequired(true))
.addStringOption(o =>
o.setName("status")
.setDescription("Mark as completed or not completed")
.setRequired(true)
.addChoices(

{ name: " Completed", value: "completed" },
{ name: " Not Completed", value: "not_completed" }
)
)
.addStringOption(o =>
o.setName("amount")
.setDescription("Amount paid (e.g. 10M, 5M, 15M) — shown on post for completed users")
.setRequired(false)
)
.addStringOption(o =>
o.setName("clear")
.setDescription("Clear all weekly payment records for this server")
.setRequired(false)
.addChoices({ name: "Clear all records", value: "clear" })
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
// ── PREMIUM SYSTEM ────────────────────────────────────────
new SlashCommandBuilder()
.setName("premium")
.setDescription("Activate premium or learn how to get it")
.addStringOption(o =>
o.setName("key")
.setDescription("Activation key given to you by the owner")
.setRequired(false)
),
new SlashCommandBuilder()
.setName("activationkey")
.setDescription("Generate a one-time premium activation key (owner only)")
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
new SlashCommandBuilder()
.setName("removepremium")
.setDescription("Remove premium from a server (owner only)")
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
// ── ANNOUNCE ──────────────────────────────────────────────
new SlashCommandBuilder()
.setName("announce")
.setDescription("Send an announcement to all servers (owner only)")
.addStringOption(o => o.setName("message").setDescription("The announcement message").setRequired(true))
.addStringOption(o => o.setName("title").setDescription("Optional title").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

// ── MESSAGE (plain text sender) ───────────────────────────
new SlashCommandBuilder()
.setName("message")
.setDescription("Send a plain message to this channel")
.addStringOption(o => o.setName("text").setDescription("The message to send").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
new SlashCommandBuilder()
.setName("weeklypaymentpost")
.setDescription("Post the weekly payment list publicly")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

new SlashCommandBuilder()
.setName("strike")
.setDescription("Give one or more users a strike")
.addStringOption(o => o.setName("users").setDescription("User IDs separated by spaces or commas").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for the strike").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("strikes")
.setDescription("View strikes for a user")
.addUserOption(o => o.setName("user").setDescription("User to check").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("clearstrikes")
.setDescription("Clear all strikes for a user")
.addUserOption(o => o.setName("user").setDescription("User to clear").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName("stafflist").setDescription("List all staff members ordered by role").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
new SlashCommandBuilder()
.setName("paymenttracking").setDescription("Track a payment between two DonutSMP players")
.addStringOption(o=>o.setName("sender").setDescription("Sender IGN").setRequired(true))
.addStringOption(o=>o.setName("receiver").setDescription("Receiver IGN").setRequired(true))
.addStringOption(o=>o.setName("amount").setDescription("Amount (e.g. 130m)").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
];
let commands = [];
try { commands = rawCommands.map(cmd=>cmd.toJSON()); console.log(" Built", commands.length, "command definitions"); }
catch(err) { console.error(" FATAL: Failed to build command definitions:", err.message); commands = []; }

// ============================================================

// REGISTER SLASH COMMANDS VIA REST
// ============================================================
async function registerCommands() {
const token=process.env.TOKEN, clientId=process.env.CLIENT_ID, guildId=process.env.GUILD_ID;
if (!token||!clientId) { console.error("Missing TOKEN or CLIENT_ID"); return; }
const rest = new REST({ version:"10" }).setToken(token);
try { for (const g of client.guilds.cache.values()) await rest.put(Routes.applicationGuildCommands(clientId,g.id),{body:[]}).catch(()=>{}); console.log("Cleared guild-scoped commands"); } catch {}
console.log("Registering slash commands...");
try {
await rest.put(Routes.applicationCommands(clientId),{body:[]});
console.log("Cleared global commands");
if (guildId) {
await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands});
console.log("Slash commands registered to guild "+guildId+" ("+commands.length+" commands)");
} else {
await rest.put(Routes.applicationCommands(clientId),{body:commands});
console.log("Slash commands registered globally ("+commands.length+" commands)");
}
} catch(err) {
console.error("REGISTRATION FAILED:", err?.message??err);
if (err?.rawError?.errors) console.error("Validation errors:", JSON.stringify(err.rawError.errors,null,2));
if (err?.status) console.error("HTTP status:", err.status);
}
}
client.on("guildCreate", async (guild) => {
console.log("Joined new guild:", guild.name);
try {
const token=process.env.TOKEN, clientId=process.env.CLIENT_ID;
if (!token||!clientId) return;
const rest = new REST({version:"10"}).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId,guild.id),{body:commands});
await rest.put(Routes.applicationCommands(clientId),{body:commands});
console.log("Commands registered instantly to",guild.name);
} catch(err) { console.error("guildCreate reg failed:", err.message); }
});

// ============================================================
// index.js — Part 2: Command Handlers
// ============================================================
// ── Helper: parse duration strings into milliseconds ─────────
// Accepts formats like 30s, 10m, 2h, 7d
function parseDuration(str) {
const match = String(str).trim().toLowerCase().match(/^(\d+(\.\d+)?)(s|m|h|d)$/);

if (!match) return NaN;
const value = parseFloat(match[1]);
const unit = match[3];
const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
return value * map[unit];
}
// ── Helper: build the giveaway embed ─────────────────────────
// ── Owner guard (absolute — Discord ID only) ─────────────────
const BOT_OWNER_ID = "1012989279049367592";
function isOwner(userId) { return userId === BOT_OWNER_ID; }
// ── Generate random 12-char activation key ────────────────────
function generateActivationKey() {
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let key = "";
for (let i = 0; i < 12; i++) key += chars[Math.floor(Math.random() * chars.length)];
return key.slice(0,4) + "-" + key.slice(4,8) + "-" + key.slice(8,12);
}
// ── Permission guard helper ──────────────────────────────────
// Returns an error reply if caller lacks the required permission.
// This is a runtime check — it can't be bypassed via the API.
function requirePerm(interaction, ...perms) {
const member = interaction.member;
if (!member) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
for (const perm of perms) {
if (!member.permissions.has(perm)) {
const names = { [PermissionFlagsBits.BanMembers]: "Ban Members", [PermissionFlagsBits.KickMembers]: "Kick Members",
[PermissionFlagsBits.ModerateMembers]: "Moderate Members (Timeout)", [PermissionFlagsBits.ManageRoles]: "Manage Roles",
[PermissionFlagsBits.ManageMessages]: "Manage Messages", [PermissionFlagsBits.ManageChannels]: "Manage Channels",
[PermissionFlagsBits.ManageGuild]: "Manage Server", [PermissionFlagsBits.ManageEvents]: "Manage Events",
[PermissionFlagsBits.Administrator]: "Administrator" };
return interaction.reply({ embeds: [errorEmbed("You need the **" + (names[perm] ?? "required") + "** permission to use this command.")], flags: MessageFlags.Ephemeral });
}
}
return null; // null = caller has permission, proceed
}
// buildGiveawayEmbed and buildDorkRow moved to handlers.js

// ── Expose shared state globally so handlers.js can access ───
// This is the correct pattern for splitting a single-file bot:
// everything defined here is attached to global so the second
// file sees it without needing module.exports of 100+ items.

global._bot = {
client, db,
// Discord.js constructors
EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
ModalBuilder, TextInputBuilder, TextInputStyle,
ChannelType, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
PermissionFlagsBits, PermissionsBitField, MessageFlags,
AttachmentBuilder, SlashCommandBuilder, REST, Routes,
// Stores (exact names as declared)
guildConfigs, vouchStore, scamVouchStore, warnStore, partnerLinks,
weeklyPaymentStore, giveawayHostCounts, pricingMessages,
inviteTracker, partnerSessions, giveawayValues, liveLeaderboards,
activeGiveaways, activeDorks, splitOrStealSessions,
premiumGuilds, activationKeys, ticketResponseLogged,
activeApplications, paymentSessions, antiRaidTracker, antiRaidPunished,
// DB functions
initDB, loadAllFromDB,
getGuildConfig, dbSaveGuildConfig, dbSaveVouch, dbSaveScamVouch,
dbSaveWarn, dbSavePartnerLinks, dbSaveWeeklyPayment,
dbClearWeeklyPayments, dbSaveGiveawayCount, dbSavePricing,
dbSaveInviteTracker, dbSavePartnerSession, dbSaveGiveawayValue,
dbSaveActiveGiveaway, dbDeleteActiveGiveaway, dbSaveStrike,
dbSaveLiveLeaderboards, dbSavePremiumGuild, dbRemovePremiumGuild,
dbSaveActivationKey, dbMarkKeyUsed, dbLogTicketStat,
// Utility functions
parseNumber, formatNumber, compactStat, errorEmbed, successEmbed,
parseDuration, BOT_OWNER_ID, isOwner, generateActivationKey,
requirePerm, INVITE_REGEX_GLOBAL,
};
// ── Load all event & interaction handlers ─────────────────────
require("./handlers");
// ── Error handling ────────────────────────────────────────────
process.on("unhandledRejection", err => console.error(" Unhandled rejection:", err));
process.on("uncaughtException", err => console.error(" Uncaught exception:", err));
// ── Bot HTTP API Server (for website integration) ─────────────
// Allows the website to: trigger announcements, grant/revoke premium,
// read guild configs, and get stats — all authenticated via BOT_API_SECRET
(async () => {
try {
const http = require("http");
const BOT_SECRET = process.env.BOT_API_SECRET;
const server = http.createServer(async (req, res) => {

// Auth check
const auth = req.headers["authorization"] ?? "";
if (!BOT_SECRET || auth !== `Bearer ${BOT_SECRET}`) {
res.writeHead(401, { "Content-Type": "application/json" });
return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
}
// Parse body
let body = "";
for await (const chunk of req) body += chunk;
let data = {};
try { data = body ? JSON.parse(body) : {}; } catch { /**/ }
const url = req.url?.split("?")[0];
res.setHeader("Content-Type", "application/json");
// ── POST /announce ──────────────────────────────────────
if (req.method === "POST" && url === "/announce") {
const { message, title } = data;
if (!message) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: "message required" })); }
let sent = 0, failed = 0;
for (const [, guild] of client.guilds.cache) {
const cfg = getGuildConfig(guild.id);
const channelId = cfg.announceChannelId ?? cfg.welcomeChannelId;
if (!channelId) { failed++; continue; }
const ch = guild.channels.cache.get(channelId);
if (!ch?.isTextBased()) { failed++; continue; }
try {
await ch.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(title || " Announcement").setDescription(message).setFooter({ text: "DonutSMP Universe Bot" }).setTimestamp()] });
sent++;
} catch { failed++; }
}
return res.end(JSON.stringify({ ok: true, sent, failed }));
}
// ── POST /premium/grant ─────────────────────────────────
if (req.method === "POST" && url === "/premium/grant") {
const { guildId } = data;
if (!guildId) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: "guildId required" })); }
premiumGuilds.set(guildId, { activatedBy: "website", activatedAt: Date.now() });
await dbSavePremiumGuild(guildId, "website");
return res.end(JSON.stringify({ ok: true }));
}
// ── POST /premium/revoke ────────────────────────────────
if (req.method === "POST" && url === "/premium/revoke") {
const { guildId } = data;

if (!guildId) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: "guildId required" })); }
await dbRemovePremiumGuild(guildId);
return res.end(JSON.stringify({ ok: true }));
}
// ── GET /guilds ─────────────────────────────────────────
if (req.method === "GET" && url === "/guilds") {
const guilds = [...client.guilds.cache.values()].map(g => ({
id: g.id, name: g.name, icon: g.icon,
memberCount: g.memberCount,
premium: premiumGuilds.has(g.id),
}));
return res.end(JSON.stringify({ ok: true, guilds }));
}
// ── GET /guild/config ───────────────────────────────────
if (req.method === "GET" && url === "/guild/config") {
const guildId = new URL("http://x" + req.url).searchParams.get("guildId");
if (!guildId) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: "guildId required" })); }
const cfg = getGuildConfig(guildId);
return res.end(JSON.stringify({ ok: true, config: cfg }));
}
// ── POST /guild/config ──────────────────────────────────
if (req.method === "POST" && url === "/guild/config") {
const { guildId, config } = data;
if (!guildId || !config) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: "guildId and config required" })); }
const existing = getGuildConfig(guildId);
Object.assign(existing, config);
guildConfigs.set(guildId, existing);
await dbSaveGuildConfig(guildId);
return res.end(JSON.stringify({ ok: true }));
}
// ── GET /stats ──────────────────────────────────────────
if (req.method === "GET" && url === "/stats") {
const guildId = new URL("http://x" + req.url).searchParams.get("guildId");
let stats = { totalGuilds: client.guilds.cache.size, premiumGuilds: premiumGuilds.size };
if (guildId) {
// Per-guild stats from DB
const [partnerRes, gwRes] = await Promise.all([
db.query("SELECT data FROM partner_links WHERE guild_id=$1", [guildId]).catch(() => ({ rows: [] })),
db.query("SELECT SUM((data->>'count')::int) as total FROM giveaway_host_counts WHERE guild_id=$1", [guildId]).catch(() => ({ rows: [] })),
]);
stats.partnerCount = partnerRes.rows[0]?.data?.links?.length ?? 0;
stats.giveawayCount = partnerRes.rows[0]?.total ?? 0;
}

return res.end(JSON.stringify({ ok: true, stats }));
}
// ── POST /poll-announcements ────────────────────────────
// Website inserts into bot_announcements table, bot polls here
if (req.method === "POST" && url === "/poll-announcements") {
try {
const pending = await db.query("SELECT * FROM bot_announcements WHERE sent=false ORDER BY created_at ASC LIMIT 10");
let sent = 0;
for (const row of pending.rows) {
let rowSent = 0, rowFailed = 0;
for (const [, guild] of client.guilds.cache) {
const cfg = getGuildConfig(guild.id);
const channelId = cfg.announceChannelId ?? cfg.welcomeChannelId;
if (!channelId) { rowFailed++; continue; }
const ch = guild.channels.cache.get(channelId);
if (!ch?.isTextBased()) { rowFailed++; continue; }
try {
await ch.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(row.title || " Announcement").setDescription(row.message).setFooter({ text: "DonutSMP Universe Bot" }).setTimestamp()] });
rowSent++;
} catch { rowFailed++; }
}
await db.query("UPDATE bot_announcements SET sent=true, sent_at=NOW() WHERE id=$1", [row.id]);
sent++;
}
return res.end(JSON.stringify({ ok: true, processed: sent }));
} catch (err) {
res.writeHead(500); return res.end(JSON.stringify({ ok: false, error: err.message }));
}
}
res.writeHead(404);
res.end(JSON.stringify({ ok: false, error: "Not found" }));
});
const BOT_API_PORT = process.env.BOT_API_PORT || 4000;
server.listen(BOT_API_PORT, "0.0.0.0", () => {
console.log(` Bot API server running on port ${BOT_API_PORT}`);
});
} catch (err) {
console.error(" Bot API server failed to start:", err.message);
}
})();
// ── Also poll bot_announcements table every 30 seconds ────────
setInterval(async () => {
try {

const tableExists = await db.query("SELECT to_regclass('public.bot_announcements')").catch(() => ({ rows: [{ to_regclass: null }] }));
if (!tableExists.rows[0]?.to_regclass) return;
const pending = await db.query("SELECT * FROM bot_announcements WHERE sent=false ORDER BY created_at ASC LIMIT 5");
for (const row of pending.rows) {
for (const [, guild] of client.guilds.cache) {
const cfg = getGuildConfig(guild.id);
const channelId = cfg.announceChannelId ?? cfg.welcomeChannelId;
if (!channelId) continue;
const ch = guild.channels.cache.get(channelId);
if (!ch?.isTextBased()) continue;
try { await ch.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(row.title || " Announcement").setDescription(row.message).setFooter({ text: "DonutSMP Universe Bot" }).setTimestamp()] }); } catch { /**/ }
}
await db.query("UPDATE bot_announcements SET sent=true, sent_at=NOW() WHERE id=$1", [row.id]).catch(() => {});
}
} catch { /**/ }
}, 30000);
// ── Connect to Discord ────────────────────────────────────────
client.login(process.env.TOKEN);