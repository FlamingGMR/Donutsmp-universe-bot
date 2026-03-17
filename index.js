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
} = require("discord.js");
// ── Client ──────────────────────────────────────────────────
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.DirectMessages,
GatewayIntentBits.DirectMessageReactions,
],
partials: [Partials.Channel, Partials.Message], // Required for DM handling in discord.js v14
});
// ── In-memory stores ─────────────────────────────────────────
// Active giveaways { messageId -> giveawayData }

const activeGiveaways = new Map();
// Active dork sessions { messageId -> dorkData }
const activeDorks = new Map();
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
// Sponsor store { guildId -> { userId -> { total, history: [{amount, timestamp}] } } }
const sponsorStore = new Map();
const partnerLinks = new Map();
// Split or steal sessions { userId -> { prize, claimDeadline, giveawayChannel, resolve } }
const splitOrStealSessions = new Map();
// Helper: get or create guild config
function getGuildConfig(guildId) {
if (!guildId) return {
welcomeEnabled: true, welcomeChannelId: null, vouchChannelId: null,
staffAppChannelId: null, pmAppChannelId: null, staffRoleId: null,
helperRoleId: null, pmRoleId: null, ticketStaffRoleId: null,
spawnerBuyPrice: 4400000, spawnerSellPrice: 5200000,

ticketTypes: null, appTypes: null,
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
const commands = [
// ── MODERATION ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("warn")
.setDescription("Warn a member")
.addUserOption(o => o.setName("user").setDescription("Member to warn").setRequired(true))
.addStringOption(o => o.setName("reason").setDescription("Reason for warning").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
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
// ── SMOKER CALCULATOR ─────────────────────────────────────
new SlashCommandBuilder()
.setName("smoker")
.setDescription("Calculate total value of smokers (1 smoker = 200k)")
.addStringOption(o =>
o.setName("amount")
.setDescription("Number of smokers (supports k/m/b, e.g. 5k)")
.setRequired(true)
),

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
// ── GIVEAWAY ─────────────────────────────────────────────
new SlashCommandBuilder()
.setName("giveaway")
.setDescription("Giveaway system")
.addSubcommand(sub =>

sub
.setName("normal")
.setDescription("Start a regular giveaway — picks a winner with no dork game")
.addStringOption(o => o.setName("prize").setDescription("Prize name / description").setRequired(true))
.addStringOption(o =>
o.setName("duration")
.setDescription("Duration (e.g. 1h, 30m, 2d)")
.setRequired(true)
)
.addStringOption(o =>
o.setName("description")
.setDescription("Extra description shown under the prize")
.setRequired(false)
)
.addIntegerOption(o =>
o.setName("winners")
.setDescription("Number of winners (default: 1)")
.setRequired(false)
.setMinValue(1)
.setMaxValue(20)
)
)
.addSubcommand(sub =>
sub
.setName("dork")
.setDescription("Start a giveaway with the dork doubling game")
.addStringOption(o => o.setName("prize").setDescription("Prize name / description").setRequired(true))
.addStringOption(o =>
o.setName("duration")
.setDescription("Duration (e.g. 1h, 30m, 2d)")
.setRequired(true)
)
.addStringOption(o =>
o.setName("maxprize")
.setDescription("Max prize cap for doubling (e.g. 10m)")
.setRequired(true)
)
.addStringOption(o =>
o.setName("description")
.setDescription("Extra description shown under the prize")
.setRequired(false)
)
)
.addSubcommand(sub =>
sub
.setName("end")
.setDescription("Force-end a giveaway early")

.addStringOption(o =>
o.setName("messageid")
.setDescription("Message ID of the giveaway to end")
.setRequired(true)
)
)
.addSubcommand(sub =>
sub
.setName("track")
.setDescription("See how many giveaways a staff member has hosted")
.addUserOption(o =>
o.setName("user")
.setDescription("Staff member to check (defaults to yourself)")
.setRequired(false)
)
)
.addSubcommand(sub =>
sub
.setName("leaderboard")
.setDescription("See who has hosted the most giveaways")
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
// ── DONUT SMP: STATS ─────────────────────────────────────
new SlashCommandBuilder()
.setName("stats")
.setDescription("View a DonutSMP player's in-game stats")
.addStringOption(o =>
o.setName("username")
.setDescription("In-game username")
.setRequired(true)
),
// ── DONUT SMP: LOOKUP ─────────────────────────────────────
new SlashCommandBuilder()
.setName("lookup")
.setDescription("Look up a DonutSMP player's rank and location")
.addStringOption(o =>
o.setName("username")
.setDescription("In-game username")
.setRequired(true)
),
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
),
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
),
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
),
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
.setDescription("Set the pricing message (Founder only)"),
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
// ── HELP / FEATURES / COMMANDS ───────────────────────────
new SlashCommandBuilder()
.setName("help")
.setDescription("Show all bot commands"),
new SlashCommandBuilder()
.setName("features")
.setDescription("Show all bot features"),
new SlashCommandBuilder()
.setName("commands")
.setDescription("Show all bot commands"),
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
// ── WARNINGS ──────────────────────────────────────────────
new SlashCommandBuilder()
.setName("warnings")
.setDescription("View warnings for a user")
.addUserOption(o => o.setName("user").setDescription("User to check").setRequired(true)),
// ── CLEAR WARNINGS ────────────────────────────────────────
new SlashCommandBuilder()
.setName("clearwarnings")
.setDescription("Clear all warnings for a user")
.addUserOption(o => o.setName("user").setDescription("User to clear").setRequired(true))
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
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
.setName("vouchesleaderboard")
.setDescription("Show the vouch leaderboard")
.addIntegerOption(o =>
o.setName("page")
.setDescription("Page number (default: 1)")
.setRequired(false)
.setMinValue(1)
),
// ── SCAM VOUCH ────────────────────────────────────────────
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
new SlashCommandBuilder()
.setName("setupwelcome")
.setDescription("Configure the welcome message for this server")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── SETUP VOUCH ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("setupvouch")
.setDescription("Configure the vouch channel for this server")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── SETUP TICKETS ─────────────────────────────────────────
new SlashCommandBuilder()
.setName("setuptickets")
.setDescription("Configure ticket buttons for this server (up to 7 buttons)")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── SETUP APPLICATIONS ────────────────────────────────────
new SlashCommandBuilder()
.setName("setupapps")
.setDescription("Configure application types for this server (up to 5)")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── SETUP ROLES ───────────────────────────────────────────
new SlashCommandBuilder()
.setName("setuproles")
.setDescription("Configure staff, helper, PM and ticket-staff roles + app review channels")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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
// ── VOUCH LEADERBOARD (replaces vouchesleaderboard) ───────

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
new SlashCommandBuilder()
.setName("setupchannels")
.setDescription("Set the vouch channel and partner tracking channel via dropdowns")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
// ── GIVEAWAY SPLIT OR STEAL ───────────────────────────────
new SlashCommandBuilder()
.setName("giveawaysplitorsteal")
.setDescription("Start a GiveawaySoS — winners choose to split or steal the prize")
.addStringOption(o => o.setName("prize").setDescription("Prize amount (e.g. 10m, 500k)").setRequired(true))
.addStringOption(o => o.setName("duration").setDescription("Giveaway duration (e.g. 1h, 30m)").setRequired(true))
.addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default: 2)").setRequired(false).setMinValue(2).setMaxValue(10))
.addStringOption(o => o.setName("claimtime").setDescription("How long winners have to respond (e.g. 5m, 24h — default: 10m)").setRequired(false))
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
// ── SPONSOR ───────────────────────────────────────────────
new SlashCommandBuilder()
.setName("sponsor")
.setDescription("Sponsor tracking system")
.addSubcommand(sub =>
sub.setName("add")
.setDescription("Add a sponsor contribution")
.addUserOption(o => o.setName("user").setDescription("The sponsor").setRequired(true))
.addStringOption(o => o.setName("amount").setDescription("Amount sponsored (e.g. 1m, 500k, 2.5b)").setRequired(true))
)
.addSubcommand(sub =>
sub.setName("leaderboard")
.setDescription("View the sponsor leaderboard")

.addStringOption(o =>
o.setName("period")
.setDescription("Time period (default: all time)")
.setRequired(false)
.addChoices(
{ name: "Last 7 Days", value: "week" },
{ name: "Last Month", value: "month" },
{ name: "All Time", value: "all" }
)
)
)
.addSubcommand(sub =>
sub.setName("check")
.setDescription("Check total sponsored by a specific user")
.addUserOption(o => o.setName("user").setDescription("User to check").setRequired(false))
)
.addSubcommand(sub =>
sub.setName("remove")
.setDescription("Remove a sponsor entry (undo last add)")
.addUserOption(o => o.setName("user").setDescription("User to remove last entry from").setRequired(true))
)
.setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
].map(cmd => cmd.toJSON());
// ============================================================
// REGISTER SLASH COMMANDS VIA REST
// ============================================================
async function registerCommands() {
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
// Wipe any leftover guild-scoped commands from ALL guilds the bot is in.
// This prevents triples when a server had both guild + global commands registered.
// We do this BEFORE registering so the slate is clean.
try {
for (const guild of client.guilds.cache.values()) {
await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
}
console.log(" Cleared all guild-scoped commands");
} catch (err) {
console.warn(" Could not clear guild commands:", err.message);
}
if (!token) throw new Error("Missing environment variable: TOKEN");

if (!clientId) throw new Error("Missing environment variable: CLIENT_ID");
const rest = new REST({ version: "10" }).setToken(token);
console.log(" Registering slash commands...");
try {
// Always wipe global commands first to prevent stale duplicates stacking
await rest.put(Routes.applicationCommands(clientId), { body: [] });
console.log(" Cleared global commands");
if (guildId) {
// Register to guild — updates instantly
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
console.log(` Slash commands registered to guild ${guildId}`);
} else {
// Register globally — takes up to 1 hour to propagate
await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log(" Slash commands registered globally");
}
} catch (err) {
console.error(" Failed to register slash commands:", err);
throw err;
}
}
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
function buildGiveawayEmbed(data) {
const endTimestamp = Math.floor(data.endsAt / 1000);
let desc = `**${data.prize}**`;
if (data.description) desc += `\n${data.description}`;
desc += `\n\n Ending: <t:${endTimestamp}:R>`;

desc += `\n Host: <@${data.hostId}>`;
desc += `\n Entries: **${data.entries.length}**`;
const embed = new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(" GIVEAWAY ")
.setDescription(desc)
.setTimestamp(data.endsAt);
if (data.maxPrize !== null && data.maxPrize !== undefined) {
embed.setFooter({ text: `Max prize cap: ${formatNumber(data.maxPrize)}` });
}
return embed;
}
// ── Helper: build dork buttons ────────────────────────────────
function buildDorkRow(currentPrize, maxPrize, dorkId, forceDisableDouble = false) {
const doubled = currentPrize * 2;
const canDouble = !forceDisableDouble && doubled <= maxPrize && currentPrize > 0;
const keepBtn = new ButtonBuilder()
.setCustomId(`dork_keep_${dorkId}`)
.setLabel(" Keep")
.setStyle(ButtonStyle.Success);
const doubleLabel = forceDisableDouble
? " Double (N/A)"
: ` Double (→ ${formatNumber(doubled)})`;
const doubleBtn = new ButtonBuilder()
.setCustomId(`dork_double_${dorkId}`)
.setLabel(doubleLabel)
.setStyle(ButtonStyle.Danger)
.setDisabled(!canDouble);
return new ActionRowBuilder().addComponents(keepBtn, doubleBtn);
}
// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on("interactionCreate", async (interaction) => {
// ── Button interactions — wrapped in try/catch to prevent silent timeout ──
if (interaction.isButton()) {

try {
return await handleButton(interaction);
} catch (err) {
console.error(" Error handling button interaction:", err);
const reply = { embeds: [errorEmbed("Something went wrong with that button.")], flags: MessageFlags.Ephemeral };
if (interaction.replied || interaction.deferred) return interaction.followUp(reply);
return interaction.reply(reply);
}
}
// ── Modal submissions (ticket close reason, future modals) ──
if (interaction.isModalSubmit()) {
try {
const cid = interaction.customId;
if (cid.startsWith("ticket_close_reason_")) {
const channelId = cid.replace("ticket_close_reason_", "");
return await handleTicketCloseModal(interaction, channelId);
}
// Embed organized modal
if (cid === "embedorganized_modal") {
const title = interaction.fields.getTextInputValue("embed_title");
const description = interaction.fields.getTextInputValue("embed_description");
let footer = "";
try { footer = interaction.fields.getTextInputValue("embed_footer").trim(); } catch { footer = ""; }
const embed = new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(title)
.setDescription(description)
.setTimestamp();
if (footer) embed.setFooter({ text: footer });
await interaction.reply({ content: "Embed sent!", flags: MessageFlags.Ephemeral });
return interaction.channel.send({ embeds: [embed] });
}
// Pricing set modal
if (cid === "pricingset_modal") {
const text = interaction.fields.getTextInputValue("pricing_text");
// Store globally (DM accessible) and per guild if in a guild
pricingMessages.set("global", text);
if (interaction.guildId) pricingMessages.set(interaction.guildId, text);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)

.setTitle("Pricing Updated")
.setDescription("The pricing message has been updated. Users can now view it with `/pricing` or `/invite`.")
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
// Setup system modals (ticket builder, app builder)
if (cid.startsWith("tsetup_modal_") || cid.startsWith("asetup_modal_")) {
const handled = await handleSetupModal(interaction);
if (handled !== false) return;
}
// Deny reason modal for application rejection
if (cid.startsWith("deny_reason_")) {
const rest = cid.replace("deny_reason_", "");
const userId = rest.match(/^(\d+)_/)?.[1];
const appType = userId ? rest.slice(userId.length + 1) : null;
if (!userId || !appType) return interaction.reply({ embeds: [errorEmbed("Invalid form data.")], flags: MessageFlags.Ephemeral });
return await handleDenyReasonModal(interaction, userId, appType);
}
} catch (err) {
console.error(" Error handling modal submission:", err);
const reply = { embeds: [errorEmbed("Something went wrong with that form.")], flags: MessageFlags.Ephemeral };
if (interaction.replied || interaction.deferred) return interaction.followUp(reply);
return interaction.reply(reply);
}
return;
}
// ── Select menu interactions (dropdowns for setup system) ──
if (interaction.isAnySelectMenu()) {
try {
const handled = await handleSetupSelect(interaction);
if (handled !== false) return;
} catch (err) {
console.error(" Error handling select menu:", err);
const reply = { embeds: [errorEmbed("Something went wrong with that selection.")], flags: MessageFlags.Ephemeral };
if (interaction.replied || interaction.deferred) return interaction.followUp(reply);
return interaction.reply(reply);
}
return;
}
if (!interaction.isChatInputCommand()) return;

const { commandName } = interaction;
try {
// ==========================================================
// MODERATION: /warn
// ==========================================================
if (commandName === "warn") {
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason");
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
// Store warning per guild
const warnKey = `${interaction.guildId}:${target.id}`;
const warnings = warnStore.get(warnKey) ?? [];
warnings.push({ reason, moderatorId: interaction.user.id, timestamp: Date.now() });
warnStore.set(warnKey, warnings);
const avatarUrl = target.displayAvatarURL({ forceStatic: false });
const embed = new EmbedBuilder()
.setColor(0xf39c12)
.setTitle("Member Warned")
.addFields(
{ name: "User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: "Warning #", value: `${warnings.length}`, inline: true },
{ name: "Reason", value: reason }
)
.setThumbnail(avatarUrl ?? null)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// MODERATION: /ban
// ==========================================================
if (commandName === "ban") {
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason") ?? "No reason provided";
const member = await interaction.guild.members.fetch(target.id).catch(() => null);

if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
if (!member.bannable) {
return interaction.reply({ embeds: [errorEmbed("I cannot ban that user. They may have a higher role than me.")], flags: MessageFlags.Ephemeral });
}
await member.ban({ reason });
const embed = new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Member Banned")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: " Reason", value: reason }
)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// MODERATION: /unban
// ==========================================================
if (commandName === "unban") {
const userId = interaction.options.getString("userid").trim();
const reason = interaction.options.getString("reason") ?? "No reason provided";
let user;
try {
user = await client.users.fetch(userId);
} catch {
return interaction.reply({ embeds: [errorEmbed("Could not find a user with that ID.")], flags: MessageFlags.Ephemeral });
}
try {
await interaction.guild.members.unban(userId, reason);
} catch {
return interaction.reply({ embeds: [errorEmbed("That user is not banned or I lack permission.")], flags: MessageFlags.Ephemeral });
}
const embed = new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Member Unbanned")
.addFields(

{ name: " User", value: `${user.username} (${userId})`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: " Reason", value: reason }
)
.setThumbnail(user.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// MODERATION: /timeout
// ==========================================================
if (commandName === "timeout") {
const target = interaction.options.getUser("user");
const durStr = interaction.options.getString("duration");
const reason = interaction.options.getString("reason") ?? "No reason provided";
const durationMs = parseDuration(durStr);
if (isNaN(durationMs)) {
return interaction.reply({ embeds: [errorEmbed("Invalid duration. Use formats like `10m`, `1h`, `7d`.")], flags: MessageFlags.Ephemeral });
}
const maxTimeout = 28 * 24 * 60 * 60 * 1000; // 28 days in ms
if (durationMs > maxTimeout) {
return interaction.reply({ embeds: [errorEmbed("Maximum timeout duration is 28 days.")], flags: MessageFlags.Ephemeral });
}
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
if (!member.moderatable) {
return interaction.reply({ embeds: [errorEmbed("I cannot timeout that user. They may have a higher role than me.")], flags: MessageFlags.Ephemeral });
}
await member.timeout(durationMs, reason);
const endsAt = Math.floor((Date.now() + durationMs) / 1000);
const embed = new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(" Member Timed Out")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: " Expires", value: `<t:${endsAt}:R>`, inline: true },

{ name: " Reason", value: reason }
)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// MODERATION: /untimeout
// ==========================================================
if (commandName === "untimeout") {
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason") ?? "No reason provided";
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
if (!member.isCommunicationDisabled()) {
return interaction.reply({ embeds: [errorEmbed("That user is not currently timed out.")], flags: MessageFlags.Ephemeral });
}
await member.timeout(null, reason);
const embed = new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Timeout Removed")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: " Reason", value: reason }
)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// ROLE MANAGEMENT: /addrole
// ==========================================================
if (commandName === "addrole") {
const target = interaction.options.getUser("user");
const role = interaction.options.getRole("role");
const member = await interaction.guild.members.fetch(target.id).catch(() => null);

if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
if (member.roles.cache.has(role.id)) {
return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> already has the <@&${role.id}> role.`)], flags: MessageFlags.Ephemeral });
}
if (!role.editable) {
return interaction.reply({ embeds: [errorEmbed("I cannot assign that role. It may be higher than my highest role.")], flags: MessageFlags.Ephemeral });
}
await member.roles.add(role);
const embed = new EmbedBuilder()
.setColor(0x3498db)
.setTitle(" Role Added")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Role", value: `<@&${role.id}>`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true }
)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// ROLE MANAGEMENT: /removerole
// ==========================================================
if (commandName === "removerole") {
const target = interaction.options.getUser("user");
const role = interaction.options.getRole("role");
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
if (!member) {
return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
}
if (!member.roles.cache.has(role.id)) {
return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> does not have the <@&${role.id}> role.`)], flags: MessageFlags.Ephemeral });
}
if (!role.editable) {
return interaction.reply({ embeds: [errorEmbed("I cannot remove that role. It may be higher than my highest role.")], flags: MessageFlags.Ephemeral });
}
await member.roles.remove(role);
const embed = new EmbedBuilder()
.setColor(0xe74c3c)

.setTitle(" Role Removed")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Role", value: `<@&${role.id}>`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true }
)
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// EMBED BUILDER: /embed
// ==========================================================
if (commandName === "embed") {
const title = interaction.options.getString("title");
const description = interaction.options.getString("description");
const colorInput = interaction.options.getString("color");
let color = 0x5865f2; // Discord blurple default
if (colorInput) {
const hex = colorInput.replace("#", "");
const parsed = parseInt(hex, 16);
if (isNaN(parsed)) {
return interaction.reply({ embeds: [errorEmbed("Invalid hex color. Example: `#ff0000`")], flags: MessageFlags.Ephemeral });
}
color = parsed;
}
const embed = new EmbedBuilder()
.setColor(color)
.setTitle(title)
.setDescription(description)
.setFooter({ text: `Posted by ${interaction.user.username}` })
.setTimestamp();
// Confirm to the command user (ephemeral), then send the real embed
await interaction.reply({ content: " Embed sent!", flags: MessageFlags.Ephemeral });
return interaction.channel.send({ embeds: [embed] });
}
// ==========================================================
// SMOKER CALCULATOR: /smoker
// ==========================================================
if (commandName === "smoker") {
const amountStr = interaction.options.getString("amount");
const amount = parseNumber(amountStr);

if (isNaN(amount) || amount <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid amount. Use a number like `50`, `5k`, `2.5m`.")], flags: MessageFlags.Ephemeral });
}
const valuePerSmoker = 200_000;
const total = amount * valuePerSmoker;
const embed = new EmbedBuilder()
.setColor(0x9b59b6)
.setTitle(" Smoker Calculator")
.addFields(
{ name: " Smokers", value: formatNumber(amount), inline: true },
{ name: " Value/Smoker", value: formatNumber(valuePerSmoker), inline: true },
{ name: " Total Value", value: `**${formatNumber(total)}**`, inline: false }
)
.setFooter({ text: "1 smoker = 200k" })
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// SPAWNER CALCULATOR: /spawner
// ==========================================================
if (commandName === "spawner") {
const amountStr = interaction.options.getString("amount");
const type = interaction.options.getString("type"); // "buy" or "sell"
const amount = parseNumber(amountStr);
const cfg = getGuildConfig(interaction.guildId);
if (isNaN(amount) || amount <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid amount. Use a number like `10`, `5k`, `2m`.")], flags: MessageFlags.Ephemeral });
}
const isBuying = type === "buy";
const priceEach = isBuying ? cfg.spawnerSellPrice : cfg.spawnerBuyPrice;
const color = isBuying ? 0xe74c3c : 0x2ecc71;
const emoji = isBuying ? " " : " ";
const actionText = isBuying ? "You pay the server" : "Server pays you";
// Calculate for input amount, 32, 64, 128
const amounts = [amount, 32, 64, 128].filter((v, i, a) => a.indexOf(v) === i); // dedupe if amount is 32/64/128
const lines = amounts.map(n => `**${formatNumber(n)}x** → **${formatNumber(n * priceEach)}**`);
const embed = new EmbedBuilder()

.setColor(color)
.setTitle(`${emoji} Spawner ${isBuying ? "Purchase" : "Sale"} Calculator`)
.addFields(
{ name: " Price Each", value: formatNumber(priceEach), inline: true },
{ name: " Transaction", value: actionText, inline: true },
{ name: " Totals", value: lines.join("\n"), inline: false }
)
.setFooter({
text: `Server sells for: ${formatNumber(cfg.spawnerSellPrice)} each | Server buys for: ${formatNumber(cfg.spawnerBuyPrice)} each`
})
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// SPAWNER PRICE CONFIG: /setspawnerprice
// ==========================================================
if (commandName === "setspawnerprice") {
const type = interaction.options.getString("type");
const priceStr = interaction.options.getString("price");
const price = parseNumber(priceStr);
const cfg = getGuildConfig(interaction.guildId);
if (isNaN(price) || price <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid price. Use a number like `4.4m`, `5200000`, `5.2m`.")], flags: MessageFlags.Ephemeral });
}
if (type === "buy") {
cfg.spawnerBuyPrice = price;
} else {
cfg.spawnerSellPrice = price;
}
const label = type === "buy" ? "Buy Price (server pays players)" : "Sell Price (players pay server)";
const embed = new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Spawner Price Updated")
.addFields(
{ name: " Type", value: label, inline: false },
{ name: " New Price", value: formatNumber(price), inline: true },
{ name: " Updated by", value: `<@${interaction.user.id}>`, inline: true }
)
.setFooter({
text: `Current prices — Buy: ${formatNumber(cfg.spawnerBuyPrice)} | Sell: ${formatNumber(cfg.spawnerSellPrice)}`
})

.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// SPAWNER PRICE SEND: /spawnerpricesend
// ==========================================================
if (commandName === "spawnerpricesend") {
const cfg = getGuildConfig(interaction.guildId);
const embed = new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(" Spawner Prices")
.addFields(
{
name: " Buying Skellys",
value: `**$${formatNumber(cfg.spawnerBuyPrice)}** per spawner`,
inline: true,
},
{
name: " Selling Skellys",
value: `**$${formatNumber(cfg.spawnerSellPrice)}** per spawner`,
inline: true,
},
{
name: "",
value: "**We never go first and if you are going with owner we only go all at once**",
inline: false,
}
)
.setTimestamp();
await interaction.reply({ content: " Spawner prices posted!", flags: MessageFlags.Ephemeral });
return interaction.channel.send({ embeds: [embed] });
}
// ==========================================================
// API Part 2: DonutSMP Command Handlers
// ==========================================================
// ==========================================================
// DONUT SMP: /stats
// ==========================================================
if (commandName === "stats") {
const username = interaction.options.getString("username");
await interaction.deferReply();

const result = await donutAPI(`/v1/stats/${encodeURIComponent(username)}`);
if (!result.ok) {
return interaction.editReply({ embeds: [errorEmbed(result.message)] });
}
const s = result.data.result;
const money = parseFloat(s.money) || 0;
const embed = new EmbedBuilder()
.setColor(0x3498db)
.setTitle(` Stats — ${username}`)
.setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`)
.addFields(
{ name: " Balance", value: `$${formatNumber(money)}`, inline: true },
{ name: " Shards", value: compactStat(s.shards ?? 0), inline: true },
{ name: " Kills", value: compactStat(s.kills ?? 0), inline: true },
{ name: " Deaths", value: compactStat(s.deaths ?? 0), inline: true },
{ name: " Mobs Killed", value: compactStat(s.mobs_killed ?? 0), inline: true },
{ name: " Playtime", value: formatPlaytime(s.playtime ?? 0), inline: true },
{ name: " Blocks Broken", value: compactStat(s.broken_blocks ?? 0), inline: true },
{ name: " Blocks Placed", value: compactStat(s.placed_blocks ?? 0), inline: true },
{ name: " Earned from /sell", value: `$${formatNumber(parseFloat(s.money_made_from_sell) || 0)}`, inline: true },
{ name: " Spent on /shop", value: `$${formatNumber(parseFloat(s.money_spent_on_shop) || 0)}`, inline: true }
)
.setFooter({ text: "DonutSMP Stats" })
.setTimestamp();
return interaction.editReply({ embeds: [embed] });
}
// ==========================================================
// DONUT SMP: /lookup
// ==========================================================
if (commandName === "lookup") {
const username = interaction.options.getString("username");
await interaction.deferReply();
const result = await donutAPI(`/v1/lookup/${encodeURIComponent(username)}`);
if (!result.ok) {
return interaction.editReply({ embeds: [errorEmbed(result.message)] });
}
const p = result.data.result;
const embed = new EmbedBuilder()
.setColor(0x9b59b6)
.setTitle(` Lookup — ${p.username ?? username}`)

.setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`)
.addFields(
{ name: " Username", value: p.username ?? username, inline: true },
{ name: " Rank", value: p.rank ?? "None", inline: true },
{ name: " Location", value: p.location ?? "Unknown", inline: true }
)
.setFooter({ text: "DonutSMP Lookup" })
.setTimestamp();
return interaction.editReply({ embeds: [embed] });
}
// ==========================================================
// DONUT SMP: /ah
// ==========================================================
if (commandName === "ah") {
const item = interaction.options.getString("item");
const sort = interaction.options.getString("sort") ?? "lowest_price";
await interaction.deferReply();
const result = await donutAPI(`/v1/auction/list/1`, {
method: "POST",
body: JSON.stringify({ search: item, sort }),
});
if (!result.ok) {
return interaction.editReply({ embeds: [errorEmbed(result.message)] });
}
const listings = result.data.result;
if (!listings || listings.length === 0) {
return interaction.editReply({
embeds: [errorEmbed(`No auction listings found for **${item}**.`)],
});
}
// Filter to listings posted in the last 24 hours
const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
const recent = listings.filter(entry => {
if (!entry.listed_at && !entry.createdAt && !entry.timestamp) return true; // keep if no date field
const ts = entry.listed_at ?? entry.createdAt ?? entry.timestamp;
const ms = typeof ts === "number" && ts > 1e10 ? ts : ts * 1000;
return ms >= oneDayAgo;
});
if (recent.length === 0) {
return interaction.editReply({

embeds: [errorEmbed(`No auction listings found for **${item}** in the last 24 hours.`)],
});
}
// Show top 10 results max to avoid embed overflow
const shown = recent.slice(0, 10);
const lines = shown.map((entry, i) => {
const name = entry.item?.display_name ?? entry.item?.id ?? "Unknown Item";
const count = entry.item?.count > 1 ? ` x${entry.item.count}` : "";
const price = `$${formatNumber(entry.price ?? 0)}`;
const seller = entry.seller?.name ?? "Unknown";
const timeLeft = formatTimeLeft(entry.time_left ?? 0);
const enchants = formatEnchants(entry.item?.enchants);
const enchantStr = enchants ? ` *(${enchants})*` : "";
return `**${i + 1}.** ${name}${count}${enchantStr}\n└ ${price} | ${seller} | ${timeLeft}`;
});
const embed = new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(` Auction House — "${item}"`)
.setDescription(lines.join("\n\n"))
.setFooter({ text: `Showing ${shown.length} of ${recent.length} results (last 24h) • Sorted by ${sort.replace(/_/g, " ")}` })
.setTimestamp();
return interaction.editReply({ embeds: [embed] });
}
// ==========================================================
// DONUT SMP: /ah-recent
// ==========================================================
if (commandName === "ah-recent") {
const page = interaction.options.getInteger("page") ?? 1;
await interaction.deferReply();
const result = await donutAPI(`/v1/auction/transactions/${page}`);
if (!result.ok) {
return interaction.editReply({ embeds: [errorEmbed(result.message)] });
}
const transactions = result.data.result;
if (!transactions || transactions.length === 0) {
return interaction.editReply({
embeds: [errorEmbed("No recent auction transactions found.")],
});
}

const shown = transactions.slice(0, 10);
const lines = shown.map((entry, i) => {
const name = entry.item?.display_name ?? entry.item?.id ?? "Unknown Item";
const count = entry.item?.count > 1 ? ` x${entry.item.count}` : "";
const price = `$${formatNumber(entry.price ?? 0)}`;
const seller = entry.seller?.name ?? "Unknown";
const soldAt = entry.unixMillisDateSold
? `<t:${Math.floor(entry.unixMillisDateSold / 1000)}:R>`
: "Unknown";
const enchants = formatEnchants(entry.item?.enchants);
const enchantStr = enchants ? ` *(${enchants})*` : "";
return `**${i + 1}.** ${name}${count}${enchantStr}\n└ ${price} | ${seller} | ${soldAt}`;
});
const embed = new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(` Recent Auction Sales — Page ${page}`)
.setDescription(lines.join("\n\n"))
.setFooter({ text: `Showing ${shown.length} of ${transactions.length} on this page • 100 per page` })
.setTimestamp();
return interaction.editReply({ embeds: [embed] });
}
// ==========================================================
// DONUT SMP: /leaderboard
// ==========================================================
if (commandName === "leaderboard") {
const type = interaction.options.getString("type");
const page = interaction.options.getInteger("page") ?? 1;
await interaction.deferReply();
const result = await donutAPI(`/v1/leaderboards/${type}/${page}`);
if (!result.ok) {
return interaction.editReply({ embeds: [errorEmbed(result.message)] });
}
const entries = result.data.result;
if (!entries || entries.length === 0) {
return interaction.editReply({
embeds: [errorEmbed("No leaderboard data found for that page.")],
});
}
const medals = [" ", " ", " "];
const startRank = (page - 1) * entries.length + 1;

const lbMeta = {
money: { label: " Money Leaderboard", unit: "$", isNumber: true },
kills: { label: " Kills Leaderboard", unit: "", isNumber: false },
deaths: { label: " Deaths Leaderboard", unit: "", isNumber: false },
playtime: { label: " Playtime Leaderboard", unit: "", isNumber: false, isTime: true },
shards: { label: " Shards Leaderboard", unit: "", isNumber: false },
sell: { label: " Most Earned (/sell)", unit: "$", isNumber: true },
shop: { label: " Most Spent (/shop)", unit: "$", isNumber: true },
mobskilled: { label: " Mobs Killed Leaderboard", unit: "", isNumber: false },
brokenblocks: { label: " Blocks Broken Leaderboard", unit: "", isNumber: false },
placedblocks: { label: " Blocks Placed Leaderboard", unit: "", isNumber: false },
};
const meta = lbMeta[type] ?? { label: `${type} Leaderboard`, unit: "", isNumber: false };
const lines = entries.map((entry, i) => {
const rank = startRank + i;
const medal = rank <= 3 ? medals[rank - 1] : `**${rank}.**`;
const username = entry.username ?? "Unknown";
let value = entry.value ?? "0";
if (meta.isTime) value = formatPlaytime(value);
else if (meta.isNumber) value = `${meta.unit}${formatNumber(parseFloat(value) || 0)}`;
else value = `${meta.unit}${value}`;
return `${medal} ${username} — ${value}`;
});
const embed = new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(meta.label)
.setDescription(lines.join("\n"))
.setFooter({ text: `Page ${page}` })
.setTimestamp();
return interaction.editReply({ embeds: [embed] });
}

// ==========================================================
// TICKET PANEL: /ticketpanelsend
// ==========================================================
if (commandName === "ticketpanelsend") return handleTicketPanelSend(interaction);
// ==========================================================
// APPLICATION PANEL: /applicationpanelsend — handled in Part 3

// ==========================================================
if (commandName === "applicationpanelsend") return handleApplicationPanelSend(interaction);
// ==========================================================
// VOUCH: /vouch
// ==========================================================
if (commandName === "vouch") {
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason");
// Prevent self-vouching
if (target.id === interaction.user.id) {
return interaction.reply({
embeds: [errorEmbed("You cannot vouch for yourself.")],
flags: MessageFlags.Ephemeral,
});
}
// Prevent vouching for bots
if (target.bot) {
return interaction.reply({
embeds: [errorEmbed("You cannot vouch for a bot.")],
flags: MessageFlags.Ephemeral,
});
}
const cfg = getGuildConfig(interaction.guildId);
const vouchChannelId = cfg.vouchChannelId;
if (!vouchChannelId) {
return interaction.reply({
embeds: [errorEmbed("Vouch channel not configured. An admin needs to run `/setupvouch` first.")],
flags: MessageFlags.Ephemeral,
});
}
let vouchChannel;
try {
vouchChannel = interaction.guild.channels.cache.get(vouchChannelId)
?? await interaction.guild.channels.fetch(vouchChannelId);
} catch {
return interaction.reply({
embeds: [errorEmbed("Could not find the vouch channel. Use `/setupvouch` to reconfigure it.")],
flags: MessageFlags.Ephemeral,
});
}
// Store vouch in memory

const existing = vouchStore.get(target.id) ?? [];
existing.push({ fromId: interaction.user.id, reason, timestamp: Date.now() });
vouchStore.set(target.id, existing);
const totalVouches = existing.length;
const embed = new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("+ Vouch")
.setDescription(
`<@${interaction.user.id}> vouched for <@${target.id}>\n\n` +
`**Reason:** ${reason}`
)
.setFooter({ text: `${target.username} now has ${totalVouches} vouch${totalVouches === 1 ? "" : "es"} • ${interaction.guild?.name ?? ""}` })
.setTimestamp();
await vouchChannel.send({ embeds: [embed] });
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("Vouch Posted")
.setDescription(`Your vouch for <@${target.id}> has been posted in <#${vouchChannelId}>.
They now have **${totalVouches}** vouch${totalVouches === 1 ? "" : "es"}.`)
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
// ==========================================================
// VOUCHCOUNT: /vouchcount
// ==========================================================
if (commandName === "vouchcount") {
const target = interaction.options.getUser("user") ?? interaction.user;
const vouches = vouchStore.get(target.id) ?? [];
const count = vouches.length;
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(`Vouches for ${target.username}`)
.setDescription(count === 0
? `${target.username} has no vouches yet.`
: `<@${target.id}> has **${count}** vouch${count === 1 ? "" : "es"}.`
)
.setTimestamp(),

],
});
}
// ==========================================================
// LOCKCHANNEL: /lockchannel
// ==========================================================
if (commandName === "lockchannel") {
const action = interaction.options.getString("action");
const reason = interaction.options.getString("reason") ?? "No reason provided";
const channel = interaction.channel;
const staffRoleId = getGuildConfig(interaction.guildId).ticketStaffRoleId;
try {
if (action === "lock") {
// Deny @everyone from sending
await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
SendMessages: false,
});
// Keep staff able to send if role set
if (staffRoleId) {
await channel.permissionOverwrites.edit(staffRoleId, {
SendMessages: true,
});
}
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle("Channel Locked")
.setDescription(`This channel has been locked by <@${interaction.user.id}>.
**Reason:** ${reason}`)
.setTimestamp(),
],
});
} else {
await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
SendMessages: null,
});
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("Channel Unlocked")
.setDescription(`This channel has been unlocked by <@${interaction.user.id}>.

**Reason:** ${reason}`)
.setTimestamp(),
],
});
}
} catch (err) {
console.error(" lockchannel error:", err);
return interaction.reply({
embeds: [errorEmbed("Failed to update channel permissions. Make sure I have Manage Channel permission.")],
flags: MessageFlags.Ephemeral,
});
}
}
// ==========================================================
// EMBEDORGANIZED: /embedorganized
// ==========================================================
if (commandName === "embedorganized") {
const modal = new ModalBuilder()
.setCustomId("embedorganized_modal")
.setTitle("Create Embed");
modal.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("embed_title")
.setLabel("Title")
.setStyle(TextInputStyle.Short)
.setPlaceholder("Enter the embed title...")
.setRequired(true)
.setMaxLength(256)
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("embed_description")
.setLabel("Description")
.setStyle(TextInputStyle.Paragraph)
.setPlaceholder("Enter the embed description. You can use multiple lines freely.")
.setRequired(true)
.setMaxLength(4000)
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("embed_footer")
.setLabel("Footer (optional)")
.setStyle(TextInputStyle.Short)
.setPlaceholder("Optional footer text...")

.setRequired(false)
.setMaxLength(2048)
),
);
return interaction.showModal(modal);
}
// ==========================================================
// PURGE: /purge
// ==========================================================
if (commandName === "purge") {
const amount = interaction.options.getInteger("amount");
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
try {
const messages = await interaction.channel.bulkDelete(amount, true);
return interaction.editReply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle("Messages Purged")
.setDescription(`Deleted **${messages.size}** message${messages.size === 1 ? "" : "s"}.`)
.setFooter({ text: `Purged by ${interaction.user.username}` })
.setTimestamp(),
],
});
} catch (err) {
console.error(" purge error:", err);
return interaction.editReply({
embeds: [errorEmbed("Failed to delete messages. Messages older than 14 days cannot be bulk deleted.")],
});
}
}
// ==========================================================
// TICKET RENAME: /ticketrename
// ==========================================================
if (commandName === "ticketrename") {
const newName = interaction.options.getString("name").toLowerCase().replace(/\s+/g, "-");
const channel = interaction.channel;
// Check if we're inside a ticket channel (default prefixes + custom from config)
const guildCfg = getGuildConfig(interaction.guildId);
const customPrefixes = (guildCfg.ticketTypes ?? []).map(t => (t.prefix ?? t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")) + "-");
const ticketPrefixes = ["support-","giveaway-","spawner-","partnership-","member-report-","staff-report-","building-","mysterybox-", ...customPrefixes];
const isTicket = ticketPrefixes.some(p => channel.name.startsWith(p));

if (!isTicket) {
return interaction.reply({
embeds: [errorEmbed("This command can only be used inside a ticket channel.")],
flags: MessageFlags.Ephemeral,
});
}
try {
await channel.setName(newName);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle("Ticket Renamed")
.setDescription(`Channel renamed to **${newName}** by <@${interaction.user.id}>.`)
.setTimestamp(),
],
});
} catch (err) {
console.error(" ticketrename error:", err);
return interaction.reply({
embeds: [errorEmbed("Failed to rename the channel.")],
flags: MessageFlags.Ephemeral,
});
}
}
// ==========================================================
// TICKET USER ADD: /ticketuseradd
// ==========================================================
if (commandName === "ticketuseradd") {
const target = interaction.options.getUser("user");
const channel = interaction.channel;
const guildCfg2 = getGuildConfig(interaction.guildId);
const customPfx2 = (guildCfg2.ticketTypes ?? []).map(t => (t.prefix ?? t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")) + "-");
const ticketPrefixes = ["support-","giveaway-","spawner-","partnership-","member-report-","staff-report-","building-","mysterybox-", ...customPfx2];
const isTicket = ticketPrefixes.some(p => channel.name.startsWith(p));
if (!isTicket) {
return interaction.reply({
embeds: [errorEmbed("This command can only be used inside a ticket channel.")],
flags: MessageFlags.Ephemeral,
});
}
try {
await channel.permissionOverwrites.edit(target.id, {

ViewChannel: true,
SendMessages: true,
ReadMessageHistory: true,
});
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("User Added to Ticket")
.setDescription(`<@${target.id}> has been added to this ticket by <@${interaction.user.id}>.`)
.setTimestamp(),
],
});
} catch (err) {
console.error(" ticketuseradd error:", err);
return interaction.reply({
embeds: [errorEmbed("Failed to add user to the ticket.")],
flags: MessageFlags.Ephemeral,
});
}
}
// ==========================================================
// TICKET USER REMOVE: /ticketuserremove
// ==========================================================
if (commandName === "ticketuserremove") {
const target = interaction.options.getUser("user");
const channel = interaction.channel;
const guildCfg3 = getGuildConfig(interaction.guildId);
const customPfx3 = (guildCfg3.ticketTypes ?? []).map(t => (t.prefix ?? t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")) + "-");
const ticketPrefixes = ["support-","giveaway-","spawner-","partnership-","member-report-","staff-report-","building-","mysterybox-", ...customPfx3];
const isTicket = ticketPrefixes.some(p => channel.name.startsWith(p));
if (!isTicket) {
return interaction.reply({
embeds: [errorEmbed("This command can only be used inside a ticket channel.")],
flags: MessageFlags.Ephemeral,
});
}
try {
await channel.permissionOverwrites.edit(target.id, {
ViewChannel: false,
SendMessages: false,
});
return interaction.reply({
embeds: [

new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle("User Removed from Ticket")
.setDescription(`<@${target.id}> has been removed from this ticket by <@${interaction.user.id}>.`)
.setTimestamp(),
],
});
} catch (err) {
console.error(" ticketuserremove error:", err);
return interaction.reply({
embeds: [errorEmbed("Failed to remove user from the ticket.")],
flags: MessageFlags.Ephemeral,
});
}
}
// ==========================================================
// PRICING: /pricing
// ==========================================================
if (commandName === "pricing" || commandName === "invite") {
const guildId = interaction.guildId;
const msg = pricingMessages.get(guildId) ?? pricingMessages.get("global") ?? null;
const guildName = interaction.guild?.name ?? "Server";
if (!msg) {
return interaction.reply({
embeds: [errorEmbed("No pricing has been set yet. The founder needs to use `/pricingset`.")],
flags: MessageFlags.Ephemeral,
});
}
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(`${guildName} Pricing & Invite`)
.setDescription(msg)
.setTimestamp(),
],
});
}
// ==========================================================
// PRICING SET: /pricingset
// ==========================================================
if (commandName === "pricingset") {
const founderId = process.env.FOUNDER_ID;
if (founderId && interaction.user.id !== founderId) {
return interaction.reply({

embeds: [errorEmbed("Only the server founder can use this command.")],
flags: MessageFlags.Ephemeral,
});
}
const existing = pricingMessages.get(interaction.guildId ?? "global") ?? "";
const modal = new ModalBuilder()
.setCustomId("pricingset_modal")
.setTitle("Set Pricing Message");
modal.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("pricing_text")
.setLabel("Pricing Message")
.setStyle(TextInputStyle.Paragraph)
.setPlaceholder("Enter the full pricing message here. Press Enter for new lines.")
.setRequired(true)
.setMaxLength(4000)
.setValue(existing)
),
);
return interaction.showModal(modal);
}
// ==========================================================
// INVITE — alias for pricing
// ==========================================================
// handled inside pricing block above
// ==========================================================
// SERVER ALL: /serverall
// ==========================================================
if (commandName === "serverall") {
const founderId = process.env.FOUNDER_ID;
if (founderId && interaction.user.id !== founderId) {
return interaction.reply({ embeds: [errorEmbed("Only the founder can use this command.")], flags: MessageFlags.Ephemeral });
}
const guilds = [...client.guilds.cache.values()]
.sort((a, b) => b.memberCount - a.memberCount);
const lines = guilds.map((g, i) => `**${i + 1}.** ${g.name} — **${g.memberCount}** members`);
const chunks = [];
for (let i = 0; i < lines.length; i += 20) chunks.push(lines.slice(i, i + 20));
const embeds = chunks.map((chunk, i) =>
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(i === 0 ? `Bot Servers (${guilds.length} total)` : "Bot Servers (continued)")
.setDescription(chunk.join("\n"))

.setTimestamp()
);
return interaction.reply({ embeds: embeds.slice(0, 10), flags: MessageFlags.Ephemeral });
}
// ==========================================================
// HELP / FEATURES / COMMANDS
// ==========================================================
if (commandName === "help" || commandName === "features" || commandName === "commands") {
const founderId = process.env.FOUNDER_ID;
const founderMention = founderId ? `<@${founderId}>` : "the server owner";
const embed = new EmbedBuilder()
.setColor(0x1e40af)
.setTitle("Bot Commands")
.addFields(
{ name: " Moderation", value: "`/warn` `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/purge` `/warnings` `/clearwarnings` `/slowmode` `/lockchannel` `/lockdown` `/unlockdown`", inline: false },
{ name: " Roles", value: "`/addrole` `/removerole`", inline: false },
{ name: " Embeds", value: "`/embed` `/embedorganized`", inline: false },
{ name: " Giveaways", value: "`/giveaway normal` `/giveaway dork` `/giveaway end` `/giveaway track` `/giveaway leaderboard`", inline: false },
{ name: " Vouches", value: "`/vouch` `/vouchcount` `/vouchesleaderboard` `/scamvouch`", inline: false },
{ name: " Tickets", value: "`/ticketpanelsend` `/ticketrename` `/ticketuseradd` `/ticketuserremove`", inline: false },
{ name: " Applications", value: "`/applicationpanelsend`", inline: false },
{ name: " Economy", value: "`/smoker` `/spawner` `/setspawnerprice` `/spawnerpricesend`", inline: false },
{ name: " DonutSMP", value: "`/stats` `/lookup` `/ah` `/ah-recent` `/leaderboard`", inline: false },
{ name: " Info", value: "`/serverinfo` `/userinfo` `/roleinfo` `/invitetracker`", inline: false },
{ name: " Pricing", value: "`/pricing` `/invite` `/pricingset`", inline: false },
{ name: " Setup", value: "`/setupwelcome` `/setupvouch` `/setuproles` `/setuptickets` `/setupapps` `/setupview`", inline: false },
)
.setFooter({ text: `If you encountered a problem please message ${founderMention}` })
.setTimestamp();
return interaction.reply({ embeds: [embed] });
}
// ==========================================================
// SLOWMODE: /slowmode
// ==========================================================
if (commandName === "slowmode") {
const durStr = interaction.options.getString("duration");
let seconds = 0;
if (durStr === "0") {
seconds = 0;
} else {
const match = String(durStr).trim().toLowerCase().match(/^(\d+(\.\d+)?)(s|m|h)?$/);
if (!match) return interaction.reply({ embeds: [errorEmbed("Invalid duration. Use formats like `0`, `5s`, `3m`, `1h`.")], flags: MessageFlags.Ephemeral });
const val = parseFloat(match[1]);
const unit = match[3] ?? "s";
const map = { s: 1, m: 60, h: 3600 };

seconds = Math.round(val * map[unit]);
}
if (seconds > 21600) return interaction.reply({ embeds: [errorEmbed("Maximum slowmode is 6 hours (21600 seconds).")], flags: MessageFlags.Ephemeral });
try {
await interaction.channel.setRateLimitPerUser(seconds);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(seconds === 0 ? 0x2ecc71 : 0xe67e22)
.setTitle(seconds === 0 ? "Slowmode Disabled" : "Slowmode Set")
.setDescription(seconds === 0 ? "Slowmode has been disabled in this channel." : `Slowmode set to **${durStr}** in this channel.`)
.setTimestamp(),
],
});
} catch {
return interaction.reply({ embeds: [errorEmbed("Failed to set slowmode.")], flags: MessageFlags.Ephemeral });
}
}
// ==========================================================
// WARNINGS: /warnings
// ==========================================================
if (commandName === "warnings") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
const target = interaction.options.getUser("user");
const warnKey = `${interaction.guildId}:${target.id}`;
const warns = warnStore.get(warnKey) ?? [];
if (warns.length === 0) {
return interaction.reply({
embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(`Warnings — ${target.username}`).setDescription("This user has no warnings.").setTimestamp()],
});
}
const lines = warns.map((w, i) =>
`**${i + 1}.** ${w.reason}
└ By <@${w.moderatorId}> • <t:${Math.floor(w.timestamp / 1000)}:R>`
);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xf39c12)
.setTitle(`Warnings — ${target.username} (${warns.length} total)`)
.setDescription(lines.join("\n\n"))
.setTimestamp(),
],
});
}

// ==========================================================
// CLEAR WARNINGS: /clearwarnings
// ==========================================================
if (commandName === "clearwarnings") {
const target = interaction.options.getUser("user");
const warnKey = `${interaction.guildId}:${target.id}`;
const count = (warnStore.get(warnKey) ?? []).length;
warnStore.delete(warnKey);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("Warnings Cleared")
.setDescription(`Cleared **${count}** warning${count === 1 ? "" : "s"} for <@${target.id}>.`)
.setTimestamp(),
],
});
}
// ==========================================================
// KICK: /kick
// ==========================================================
if (commandName === "kick") {
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason") ?? "No reason provided";
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
if (!member) return interaction.reply({ embeds: [errorEmbed("That user is not in this server.")], flags: MessageFlags.Ephemeral });
if (!member.kickable) return interaction.reply({ embeds: [errorEmbed("I cannot kick that user. They may have a higher role than me.")], flags: MessageFlags.Ephemeral });
await member.kick(reason);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(" Member Kicked")
.addFields(
{ name: " User", value: `<@${target.id}> (${target.username})`, inline: true },
{ name: " Moderator", value: `<@${interaction.user.id}>`, inline: true },
{ name: " Reason", value: reason }
)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp(),
],
});
}
// ==========================================================
// SERVER INFO: /serverinfo

// ==========================================================
if (commandName === "serverinfo") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
const guild = interaction.guild;
try { await guild.fetch(); } catch { /* use cached data */ }
const created = Math.floor(guild.createdTimestamp / 1000);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(`${guild.name}`)
.setThumbnail(guild.iconURL({ forceStatic: false }) ?? null)
.addFields(
{ name: " Members", value: `${guild.memberCount}`, inline: true },
{ name: " Boosts", value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
{ name: " Created", value: `<t:${created}:R>`, inline: true },
{ name: " Owner", value: `<@${guild.ownerId}>`, inline: true },
{ name: " Boost Level", value: `Level ${guild.premiumTier}`, inline: true },
{ name: " Channels", value: `${guild.channels.cache.size}`, inline: true }
)
.setFooter({ text: `ID: ${guild.id}` })
.setTimestamp(),
],
});
}
// ==========================================================
// USER INFO: /userinfo
// ==========================================================
if (commandName === "userinfo") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
const target = interaction.options.getUser("user") ?? interaction.user;
const member = await interaction.guild.members.fetch(target.id).catch(() => null);
const warnKey = `${interaction.guildId}:${target.id}`;
const warns = warnStore.get(warnKey) ?? [];
const vouches = vouchStore.get(target.id) ?? [];
const scams = scamVouchStore.get(target.id) ?? [];
const created = Math.floor(target.createdTimestamp / 1000);
const joined = member ? Math.floor(member.joinedTimestamp / 1000) : null;
const roles = member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => `<@&${r.id}>`).join(" ") || "None" : "Not in server";
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(`${target.username}`)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }) ?? null)
.addFields(

{ name: " Account Created", value: `<t:${created}:R>`, inline: true },
{ name: " Joined Server", value: joined ? `<t:${joined}:R>` : "N/A", inline: true },
{ name: " Warnings", value: `${warns.length}`, inline: true },
{ name: " Vouches", value: `${vouches.length}`, inline: true },
{ name: " Scam Vouches", value: `${scams.length}`, inline: true },
{ name: " Roles", value: roles, inline: false },
)
.setFooter({ text: `ID: ${target.id}` })
.setTimestamp(),
],
});
}
// ==========================================================
// ROLE INFO: /roleinfo
// ==========================================================
if (commandName === "roleinfo") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
const role = interaction.options.getRole("role");
const members = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id));
const created = Math.floor(role.createdTimestamp / 1000);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(role.color || 0x1e40af)
.setTitle(`Role: ${role.name}`)
.addFields(
{ name: " Members", value: `${members.size}`, inline: true },
{ name: " Created", value: `<t:${created}:R>`, inline: true },
{ name: " Color", value: role.hexColor, inline: true },
{ name: " Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
{ name: " Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
)
.setFooter({ text: `ID: ${role.id}` })
.setTimestamp(),
],
});
}
// ==========================================================
// INVITE TRACKER: /invitetracker
// ==========================================================
if (commandName === "invitetracker") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });
const period = interaction.options.getString("period") ?? "all";
const data = inviteTracker.get(interaction.guildId) ?? { joins: [], leaves: [] };
const now = Date.now();

const cutoffs = { "24h": 86400000, "week": 604800000, "month": 2592000000, "all": Infinity };
const cutoff = cutoffs[period] ?? Infinity;
const joins = data.joins.filter(e => (now - e.timestamp) <= cutoff).length;
const leaves = data.leaves.filter(e => (now - e.timestamp) <= cutoff).length;
const labels = { "24h": "Last 24 Hours", "week": "Last Week", "month": "Last Month", "all": "All Time" };
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(`Invite Tracker — ${labels[period]}`)
.addFields(
{ name: " Joins", value: `${joins}`, inline: true },
{ name: " Leaves", value: `${leaves}`, inline: true },
{ name: " Net", value: `${joins - leaves >= 0 ? "+" : ""}${joins - leaves}`, inline: true }
)
.setTimestamp(),
],
});
}
// ==========================================================
// VOUCHES LEADERBOARD: /vouchesleaderboard
// ==========================================================
if (commandName === "vouchesleaderboard") {
const page = interaction.options.getInteger("page") ?? 1;
const perPage = 10;
const sorted = [...vouchStore.entries()]
.map(([userId, v]) => ({ userId, count: v.length }))
.sort((a, b) => b.count - a.count);
if (sorted.length === 0) {
return interaction.reply({ embeds: [errorEmbed("No vouches have been recorded yet.")], flags: MessageFlags.Ephemeral });
}
const totalPages = Math.ceil(sorted.length / perPage);
const safePage = Math.min(page, totalPages);
const slice = sorted.slice((safePage - 1) * perPage, safePage * perPage);
const medals = [" ", " ", " "];
const lines = slice.map((entry, i) => {
const rank = (safePage - 1) * perPage + i + 1;
const scams = (scamVouchStore.get(entry.userId) ?? []).length;
const scamStr = scams > 0 ? ` ${scams} scam` : "";
return `${medals[i] ?? `**${rank}.**`} <@${entry.userId}> — **${entry.count}** vouch${entry.count === 1 ? "" : "es"}${scamStr}`;
});

return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("Vouch Leaderboard")
.setDescription(lines.join("\n"))
.setFooter({ text: `Page ${safePage} of ${totalPages}` })
.setTimestamp(),
],
});
}
// ==========================================================
// SCAM VOUCH: /scamvouch
// ==========================================================
if (commandName === "scamvouch") {
const action = interaction.options.getString("action");
const target = interaction.options.getUser("user");
const reason = interaction.options.getString("reason") ?? "No reason provided";
if (action === "add") {
const scams = scamVouchStore.get(target.id) ?? [];
scams.push({ fromId: interaction.user.id, reason, timestamp: Date.now() });
scamVouchStore.set(target.id, scams);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Scam Vouch Added")
.setDescription(`<@${target.id}> has been marked as a scammer.
**Reason:** ${reason}
**Total scam vouches:** ${scams.length}`)
.setFooter({ text: `Added by ${interaction.user.username}` })
.setTimestamp(),
],
});
} else {
const scams = scamVouchStore.get(target.id) ?? [];
if (scams.length === 0) {
return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> has no scam vouches to remove.`)], flags: MessageFlags.Ephemeral });
}
// Remove the most recent one
scams.pop();
if (scams.length === 0) scamVouchStore.delete(target.id);
else scamVouchStore.set(target.id, scams);

return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle("Scam Vouch Removed")
.setDescription(`One scam vouch removed from <@${target.id}>.
**Remaining scam vouches:** ${scams.length}`)
.setFooter({ text: `Removed by ${interaction.user.username}` })
.setTimestamp(),
],
});
}
}
// ==========================================================
// LOCKDOWN / UNLOCKDOWN
// ==========================================================
if (commandName === "lockdown" || commandName === "unlockdown") {
const founderId = process.env.FOUNDER_ID;
if (founderId && interaction.user.id !== founderId) {
return interaction.reply({ embeds: [errorEmbed("Only the founder can use this command.")], flags: MessageFlags.Ephemeral });
}
const isLock = commandName === "lockdown";
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
const textChannels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
let success = 0, failed = 0;
for (const [, ch] of textChannels) {
try {
await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: isLock ? false : null });
success++;
} catch { failed++; }
}
return interaction.editReply({
embeds: [
new EmbedBuilder()
.setColor(isLock ? 0xe74c3c : 0x2ecc71)
.setTitle(isLock ? "Server Locked Down" : "Server Unlocked")
.setDescription(
isLock
? `All channels have been locked. Nobody can send messages.
${success} channels locked${failed > 0 ? ` | ${failed} failed` : ""}.`
: `All channels have been unlocked.

${success} channels unlocked${failed > 0 ? ` | ${failed} failed` : ""}.`
)
.setTimestamp(),
],
});
}
// ==========================================================
// SETUP WELCOME: /setupwelcome
// ==========================================================
if (commandName === "setupwelcome") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const cfg = getGuildConfig(interaction.guildId);
const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Welcome Setup")
.setDescription(
"**Current config:**\n" +
"Channel: " + (cfg.welcomeChannelId ? "<#" + cfg.welcomeChannelId + ">" : "not set") + "\n" +
"Enabled: " + (cfg.welcomeEnabled ? " Yes" : " No") + "\n\n" +
"Use the dropdown to pick a channel, then toggle with the buttons below."
)
.setTimestamp();
return interaction.reply({
embeds: [embed],
components: [
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupwelcome_channel")
.setPlaceholder(" Pick the welcome channel")
.addChannelTypes(ChannelType.GuildText)
),
new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId("setupwelcome_enable").setLabel(" Enable Welcomes").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId("setupwelcome_disable").setLabel(" Disable Welcomes").setStyle(ButtonStyle.Danger),
),
],
flags: MessageFlags.Ephemeral,
});
}
// ==========================================================
// SETUP VOUCH: /setupvouch
// ==========================================================
if (commandName === "setupvouch") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const cfg = getGuildConfig(interaction.guildId);

const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Vouch Setup")
.setDescription(
"**Current config:**\n" +
"Channel: " + (cfg.vouchChannelId ? "<#" + cfg.vouchChannelId + ">" : "not set") + "\n\n" +
"Select the channel where vouches should be posted."
)
.setTimestamp();
return interaction.reply({
embeds: [embed],
components: [
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupvouch_channel")
.setPlaceholder(" Pick the vouch channel")
.addChannelTypes(ChannelType.GuildText)
),
],
flags: MessageFlags.Ephemeral,
});
}
// ==========================================================
// SETUP ROLES: /setuproles
// ==========================================================
if (commandName === "setuproles") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const cfg = getGuildConfig(interaction.guildId);
const { embeds, components } = buildRolesSetupMessage(interaction.guild, cfg);
return interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
}
// ==========================================================
// SETUP TICKETS: /setuptickets
// ==========================================================
if (commandName === "setuptickets") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
return handleSetupTickets(interaction);
}
// ==========================================================
// SETUP APPS: /setupapps
// ==========================================================
if (commandName === "setupapps") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
return handleSetupApps(interaction);

}
// ==========================================================
// SETUP VIEW: /setupview
// ==========================================================
if (commandName === "setupview") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const cfg = getGuildConfig(interaction.guildId);
const ticketSummary = cfg.ticketTypes && cfg.ticketTypes.length > 0
? cfg.ticketTypes.map((t, i) => (i + 1) + ". **" + t.name + "** — category: `" + (t.categoryId || "not set") + "`").join("\n")
: "Using built-in defaults";
const appSummary = cfg.appTypes && cfg.appTypes.length > 0
? cfg.appTypes.map((a, i) => (i + 1) + ". **" + a.name + "** — " + (a.questions?.length || 0) + " questions, review: " + (a.channelId ? "<#" + a.channelId + ">" : "not set")).join("\n")
: "Using built-in defaults (Staff + Partner Manager)";
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle(" Server Config — " + interaction.guild?.name ?? "this server")
.addFields(
{ name: " Welcome", value: "Channel: " + (cfg.welcomeChannelId ? "<#" + cfg.welcomeChannelId + ">" : "Not set") + " | Enabled: " + (cfg.welcomeEnabled ? "Yes" : "No"), inline: false },
{ name: " Vouch Channel", value: cfg.vouchChannelId ? "<#" + cfg.vouchChannelId + ">" : "Not set", inline: true },
{ name: " Staff Apps", value: cfg.staffAppChannelId ? "<#" + cfg.staffAppChannelId + ">" : "Not set", inline: true },
{ name: " PM Apps", value: cfg.pmAppChannelId ? "<#" + cfg.pmAppChannelId + ">" : "Not set", inline: true },
{ name: " Staff Role", value: cfg.staffRoleId ? "<@&" + cfg.staffRoleId + ">" : "Not set", inline: true },
{ name: " Helper Role", value: cfg.helperRoleId ? "<@&" + cfg.helperRoleId + ">" : "Not set", inline: true },
{ name: " PM Role", value: cfg.pmRoleId ? "<@&" + cfg.pmRoleId + ">" : "Not set", inline: true },
{ name: " Ticket Staff Role",value: cfg.ticketStaffRoleId ? "<@&" + cfg.ticketStaffRoleId + ">" : "Not set", inline: true },
{ name: " Spawner Buy", value: formatNumber(cfg.spawnerBuyPrice), inline: true },
{ name: " Spawner Sell", value: formatNumber(cfg.spawnerSellPrice), inline: true },
{ name: " Ticket Buttons", value: ticketSummary, inline: false },
{ name: " Application Types", value: appSummary, inline: false },
)
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
// ==========================================================
// CLOSE TICKET: /close
// ==========================================================
if (commandName === "close") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
return handleTicketClose(interaction, interaction.channelId);
}

// ==========================================================
// SETUP CHANNELS: /setupchannels
// ==========================================================
if (commandName === "setupchannels") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const cfg = getGuildConfig(interaction.guildId);
return interaction.reply({
embeds: [new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Channel Setup")
.setDescription(
"Use the dropdowns below to configure channels.\n\n" +
"**Current:**\n" +
" Vouch Channel: " + (cfg.vouchChannelId ? "<#" + cfg.vouchChannelId + ">" : "not set") + "\n" +
" Partner Channel: " + (cfg.partnerChannelId ? "<#" + cfg.partnerChannelId + ">" : "not set")
).setTimestamp()],
components: [
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupchannels_vouch")
.setPlaceholder(" Vouch channel — where vouches are posted")
.addChannelTypes(ChannelType.GuildText)
),
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupchannels_partner")
.setPlaceholder(" Partner channel — tracked for Discord invite links")
.addChannelTypes(ChannelType.GuildText)
),
],
flags: MessageFlags.Ephemeral,
});
}
// ==========================================================
// PARTNER TRACKING: /partnertracking
// ==========================================================
if (commandName === "partnertracking") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const partnerEmbed = buildPartnerLeaderboard(interaction.guildId, interaction.options.getString("period") ?? "all");
return interaction.reply({ embeds: [partnerEmbed] });
}
// ==========================================================
// GIVEAWAY TRACKING: /giveawaytracking
// ==========================================================
if (commandName === "giveawaytracking") {

if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
return interaction.reply({
embeds: [buildGiveawayTrackingLeaderboard(interaction.guildId, interaction.options.getString("period") ?? "all")],
});
}
// ==========================================================
// VOUCH LEADERBOARD: /vouchleaderboard
// ==========================================================
if (commandName === "vouchleaderboard") {
return interaction.reply({
embeds: [buildVouchLeaderboard(interaction.guildId, interaction.options.getString("period") ?? "all")],
});
}
// ==========================================================
// SPLIT OR STEAL: /giveawaysplitorsteal
// ==========================================================
if (commandName === "giveawaysplitorsteal") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
return handleSplitOrStealStart(interaction);
}
// ==========================================================
// SPONSOR: /sponsor
// ==========================================================
if (commandName === "sponsor") {
if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed("Server only.")], flags: MessageFlags.Ephemeral });
const sub = interaction.options.getSubcommand();
const guildId = interaction.guildId;
if (!sponsorStore.has(guildId)) sponsorStore.set(guildId, new Map());
const guildSponsors = sponsorStore.get(guildId);
if (sub === "add") {
const target = interaction.options.getUser("user");
const amountStr = interaction.options.getString("amount");
const amount = parseNumber(amountStr);
if (isNaN(amount) || amount <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid amount. Use formats like `1m`, `500k`, `2.5b`.")], flags: MessageFlags.Ephemeral });
}
const existing = guildSponsors.get(target.id) ?? { total: 0, history: [] };
existing.total += amount;
existing.history.push({ amount, timestamp: Date.now(), addedBy: interaction.user.id });
guildSponsors.set(target.id, existing);

return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(" Sponsor Added")
.setDescription(
`<@${target.id}> sponsored **${formatNumber(amount)}**!
` +
`**All-time total:** ${formatNumber(existing.total)}
` +
`**Added by:** <@${interaction.user.id}>`
)
.setTimestamp(),
],
});
}
if (sub === "remove") {
const target = interaction.options.getUser("user");
const entry = guildSponsors.get(target.id);
if (!entry || entry.history.length === 0) {
return interaction.reply({ embeds: [errorEmbed(`No sponsor entries found for <@${target.id}>.`)], flags: MessageFlags.Ephemeral });
}
const last = entry.history.pop();
entry.total = Math.max(0, entry.total - last.amount);
if (entry.history.length === 0) guildSponsors.delete(target.id);
else guildSponsors.set(target.id, entry);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Sponsor Entry Removed")
.setDescription(
`Removed **${formatNumber(last.amount)}** from <@${target.id}>'s sponsor total.
` +
`**New total:** ${formatNumber(entry.total)}`
)
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
if (sub === "check") {

const target = interaction.options.getUser("user") ?? interaction.user;
const entry = guildSponsors.get(target.id);
if (!entry || entry.total === 0) {
return interaction.reply({ embeds: [errorEmbed(`<@${target.id}> has no sponsor contributions recorded.`)], flags: MessageFlags.Ephemeral });
}
const recent = entry.history.slice(-5).reverse();
const recentLines = recent.map(h => "• **" + formatNumber(h.amount) + "** — <t:" + Math.floor(h.timestamp/1000) + ":R>").join("\n");
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(` Sponsor Total — ${target.username}`)
.addFields(
{ name: " All-Time Total", value: formatNumber(entry.total), inline: true },
{ name: " Contributions", value: String(entry.history.length), inline: true },
{ name: " Recent (last 5)", value: recentLines || "None", inline: false },
)
.setThumbnail(target.displayAvatarURL({ forceStatic: false }))
.setTimestamp(),
],
});
}
if (sub === "leaderboard") {
const period = interaction.options.getString("period") ?? "all";
const cutoff = getPeriodCutoff(period);
const labels = { week: "Last 7 Days", month: "Last Month", all: "All Time" };
const entries = [];
for (const [userId, data] of guildSponsors.entries()) {
const total = period === "all"
? data.total
: data.history.filter(h => h.timestamp >= cutoff).reduce((sum, h) => sum + h.amount, 0);
if (total > 0) entries.push({ userId, total });
}
entries.sort((a, b) => b.total - a.total);
if (entries.length === 0) {
return interaction.reply({ embeds: [errorEmbed("No sponsor contributions recorded in this period.")], flags: MessageFlags.Ephemeral });
}
const medals = [" ", " ", " "];
const lines = entries.slice(0, 15).map(({ userId, total }, i) =>
`${medals[i] ?? `**${i + 1}.**`} <@${userId}> — **${formatNumber(total)}**`
);

return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(` Sponsor Leaderboard — ${labels[period]}`)
.setDescription(lines.join("\n"))
.setFooter({ text: "Amounts accumulate across all contributions" })
.setTimestamp(),
],
});
}
}
// ==========================================================
// GIVEAWAY: handled in Part 3
// ==========================================================
if (commandName === "giveaway") return handleGiveaway(interaction);
} catch (err) {
console.error(` Error handling command "${commandName}":`, err);
const reply = { embeds: [errorEmbed("Something went wrong. Please try again.")], flags: MessageFlags.Ephemeral };
if (interaction.replied || interaction.deferred) {
return interaction.followUp(reply);
}
return interaction.reply(reply);
}
});
// ============================================================
// SETUP SYSTEM — Interactive panel-based configuration
// ============================================================
// In-memory setup sessions { userId_guildId_type -> sessionData }
const setupSessions = new Map();
// ─────────────────────────────────────────────────────────────
// TICKET SETUP HELPERS
// ─────────────────────────────────────────────────────────────
function buildTicketSetupEmbed(session, guildName) {
const buttons = session.ticketButtons || [];
let desc = "Configure up to **7 ticket buttons** for your panel.\n";
desc += "Each button creates a new ticket channel inside the category you pick.\n\n";
if (buttons.length === 0) {
desc += "*No buttons yet — click ** Add Button** to start.*";
} else {

buttons.forEach((b, i) => {
const expanded = session.expandedTicket === i;
if (expanded) {
desc += `**Button ${i + 1}: ${b.name || "Unnamed"}** ▼\n`;
desc += ` Category: ${b.categoryId ? `<#${b.categoryId}>` : "*(not set — select below)*"}\n`;
desc += ` Color: ${b.color || "Blue (default)"}\n`;
desc += ` Welcome Message: ${b.description ? b.description.slice(0, 80) + (b.description.length > 80 ? "..." : "") : "*(not set)*"}\n`;
desc += ` Ping Roles: ${b.pingRoleIds?.length ? b.pingRoleIds.map(r => `<@&${r}>`).join(" ") : "none"}\n`;
desc += ` Viewer Roles (can see ticket): ${b.viewerRoleIds?.length ? b.viewerRoleIds.map(r => `<@&${r}>`).join(" ") : "uses ticket-staff role"}\n\n`;
} else {
const cat = b.categoryId ? `<#${b.categoryId}>` : "no category";
desc += `**Button ${i + 1}: ${b.name || "Unnamed"}** — ${cat} ▶ *(click to expand)*\n`;
}
});
}
return new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Ticket Setup — " + guildName)
.setDescription(desc)
.setFooter({ text: buttons.length + "/7 buttons • Select menus appear when a button is expanded • Save when done" })
.setTimestamp();
}
function buildTicketSetupRows(session, guild) {
const buttons = session.ticketButtons || [];
const rows = [];
// Row 1: toggle buttons (slots 1-4)
if (buttons.length > 0) {
const row1 = new ActionRowBuilder();
buttons.slice(0, 4).forEach((b, i) => {
row1.addComponents(
new ButtonBuilder()
.setCustomId("tsetup_toggle_" + i)
.setLabel((session.expandedTicket === i ? "▼ " : "▶ ") + (b.name || "Button " + (i + 1)).slice(0, 15))
.setStyle(session.expandedTicket === i ? ButtonStyle.Primary : ButtonStyle.Secondary)
);
});
rows.push(row1);
}
// Row 2: toggle buttons (slots 5-7)
if (buttons.length > 4) {
const row2 = new ActionRowBuilder();
buttons.slice(4).forEach((b, i) => {
row2.addComponents(
new ButtonBuilder()

.setCustomId("tsetup_toggle_" + (i + 4))
.setLabel((session.expandedTicket === (i + 4) ? "▼ " : "▶ ") + (b.name || "Button " + (i + 5)).slice(0, 15))
.setStyle(session.expandedTicket === (i + 4) ? ButtonStyle.Primary : ButtonStyle.Secondary)
);
});
rows.push(row2);
}
// If a button is expanded, show its select menus + action buttons
const ei = session.expandedTicket;
if (ei !== null && ei !== undefined && buttons[ei]) {
// Category select
const cats = (guild?.channels?.cache?.filter(c => c.type === ChannelType.GuildCategory) ?? new Map());
if (cats.size > 0) {
const catOptions = [...cats.values()].slice(0, 25).map(c =>
new StringSelectMenuOptionBuilder()
.setLabel((c.name || "Unnamed Category").slice(0, 100))
.setValue(c.id)
.setDefault(buttons[ei].categoryId === c.id)
);
rows.push(new ActionRowBuilder().addComponents(
new StringSelectMenuBuilder()
.setCustomId("tsetup_cat_" + ei)
.setPlaceholder(" Pick a category for this ticket type")
.addOptions(catOptions)
));
} else {
// No categories cached yet — show a note in the embed, no crash
}
// Ping roles select (multi, up to 5)
rows.push(new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("tsetup_pingroles_" + ei)
.setPlaceholder(" Roles to ping when ticket opens (optional)")
.setMinValues(0)
.setMaxValues(5)
));
// Viewer roles select (multi, up to 5)
rows.push(new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("tsetup_viewerroles_" + ei)
.setPlaceholder(" Extra roles that can see this ticket (optional)")
.setMinValues(0)
.setMaxValues(5)
));

}
// Action row: Add / Edit / Delete / Color / Save
const actionRow = new ActionRowBuilder();
if (buttons.length < 7) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("tsetup_add").setLabel(" Add Button").setStyle(ButtonStyle.Success)
);
}
if (ei !== null && ei !== undefined && buttons[ei]) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("tsetup_edit_" + ei).setLabel(" Edit " + (ei + 1)).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId("tsetup_color_" + ei).setLabel(" Color").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId("tsetup_delete_" + ei).setLabel(" Delete").setStyle(ButtonStyle.Danger)
);
}
if (buttons.length > 0) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("tsetup_save").setLabel(" Save All").setStyle(ButtonStyle.Success)
);
}
if (actionRow.components.length > 0) rows.push(actionRow);
return rows.slice(0, 5); // Discord max 5 rows
}
// ─────────────────────────────────────────────────────────────
// APP SETUP HELPERS
// ─────────────────────────────────────────────────────────────
function buildAppSetupEmbed(session, guildName) {
const apps = session.appTypes || [];
let desc = "Configure up to **5 application types**.\n";
desc += "Each has its own questions, review channel, and role given on acceptance.\n\n";
if (apps.length === 0) {
desc += "*No app types yet — click ** Add Application** to start.*";
} else {
apps.forEach((a, i) => {
if (session.expandedApp === i) {
desc += `**App ${i + 1}: ${a.name || "Unnamed"}** ▼\n`;
desc += ` Review Channel: ${a.channelId ? `<#${a.channelId}>` : "*(not set — select below)*"}\n`;
desc += ` Role on Accept: ${a.roleId ? `<@&${a.roleId}>` : "none *(select below)*"}\n`;
desc += ` Required Role to Apply: ${a.requiredRoleId ? `<@&${a.requiredRoleId}>` : "none (anyone can apply)"}\n`;
desc += ` Questions (${a.questions?.length || 0}/10):\n`;
(a.questions || []).forEach((q, qi) => {
desc += ` ${qi + 1}. ${q.slice(0, 70)}${q.length > 70 ? "..." : ""}\n`;
});

desc += "\n";
} else {
const ch = a.channelId ? `<#${a.channelId}>` : "no channel";
desc += `**App ${i + 1}: ${a.name || "Unnamed"}** — ${ch} — ${a.questions?.length || 0} questions ▶\n`;
}
});
}
return new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Application Setup — " + guildName)
.setDescription(desc)
.setFooter({ text: apps.length + "/5 app types • Select menus appear when expanded • Save when done" })
.setTimestamp();
}
function buildAppSetupRows(session) {
const apps = session.appTypes || [];
const rows = [];
// Toggle row
if (apps.length > 0) {
const toggleRow = new ActionRowBuilder();
apps.forEach((a, i) => {
toggleRow.addComponents(
new ButtonBuilder()
.setCustomId("asetup_toggle_" + i)
.setLabel((session.expandedApp === i ? "▼ " : "▶ ") + (a.name || "App " + (i + 1)).slice(0, 15))
.setStyle(session.expandedApp === i ? ButtonStyle.Primary : ButtonStyle.Secondary)
);
});
rows.push(toggleRow);
}
const ei = session.expandedApp;
if (ei !== null && ei !== undefined && apps[ei]) {
// Review channel select
rows.push(new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("asetup_channel_" + ei)
.setPlaceholder(" Review channel — staff see applications here")
.addChannelTypes(ChannelType.GuildText)
));
// Role on accept (single)
rows.push(new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("asetup_role_" + ei)

.setPlaceholder(" Role to give when application is accepted (optional)")
.setMinValues(0)
.setMaxValues(1)
));
// Required role to apply (single)
rows.push(new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("asetup_requiredrole_" + ei)
.setPlaceholder(" Required role to apply (leave blank = anyone can apply)")
.setMinValues(0)
.setMaxValues(1)
));
}
// Action row
const actionRow = new ActionRowBuilder();
if (apps.length < 5) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("asetup_add").setLabel(" Add Application").setStyle(ButtonStyle.Success)
);
}
if (ei !== null && ei !== undefined && apps[ei]) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("asetup_edit_" + ei).setLabel(" Edit Questions").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId("asetup_delete_" + ei).setLabel(" Delete").setStyle(ButtonStyle.Danger)
);
}
if (apps.length > 0) {
actionRow.addComponents(
new ButtonBuilder().setCustomId("asetup_save").setLabel(" Save All").setStyle(ButtonStyle.Success)
);
}
if (actionRow.components.length > 0) rows.push(actionRow);
return rows.slice(0, 5);
}
// ─────────────────────────────────────────────────────────────
// ROLES SETUP HELPER
// ─────────────────────────────────────────────────────────────
function buildRolesSetupMessage(guild, cfg) {
const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Roles & Channels Setup")
.setDescription(

"Use the dropdowns below to configure each role and channel.\n" +
"Each selection saves **instantly** — no need to confirm.\n\n" +
"**Current Config:**\n" +
" Staff Role: " + (cfg.staffRoleId ? "<@&" + cfg.staffRoleId + ">" : "not set") + "\n" +
" Helper Role: " + (cfg.helperRoleId ? "<@&" + cfg.helperRoleId + ">" : "not set") + "\n" +
" Partner Manager Role: " + (cfg.pmRoleId ? "<@&" + cfg.pmRoleId + ">" : "not set") + "\n" +
" Ticket Staff Role: " + (cfg.ticketStaffRoleId ? "<@&" + cfg.ticketStaffRoleId + ">" : "not set") + "\n" +
" Staff Apps Channel: " + (cfg.staffAppChannelId ? "<#" + cfg.staffAppChannelId + ">" : "not set") + "\n" +
" PM Apps Channel: " + (cfg.pmAppChannelId ? "<#" + cfg.pmAppChannelId + ">" : "not set") + "\n\n" +
" *PM Apps review channel is set per-application in `/setupapps`*"
)
.setFooter({ text: "Select a role or channel below — changes apply immediately" })
.setTimestamp();
const components = [
new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("setuproles_staff")
.setPlaceholder(" Staff Role — moderators, admins")
.setMinValues(0).setMaxValues(1)
),
new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("setuproles_helper")
.setPlaceholder(" Helper Role — junior staff")
.setMinValues(0).setMaxValues(1)
),
new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("setuproles_pm")
.setPlaceholder(" Partner Manager Role")
.setMinValues(0).setMaxValues(1)
),
new ActionRowBuilder().addComponents(
new RoleSelectMenuBuilder()
.setCustomId("setuproles_ticketstaff")
.setPlaceholder(" Ticket Staff Role — can see all tickets")
.setMinValues(0).setMaxValues(1)
),
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setuproles_staffappschan")
.setPlaceholder(" Staff Applications review channel")
.addChannelTypes(ChannelType.GuildText)
),
];

return { embeds: [embed], components };
}
// ─────────────────────────────────────────────────────────────
// COMMAND ENTRY POINTS
// ─────────────────────────────────────────────────────────────
async function handleSetupTickets(interaction) {
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const cfg = getGuildConfig(interaction.guildId);
setupSessions.set(sessionKey, {
type: "tickets",
guildId: interaction.guildId,
ticketButtons: cfg.ticketTypes ? cfg.ticketTypes.map(t => ({ ...t })) : [],
expandedTicket: null,
});
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: MessageFlags.Ephemeral });
return interaction.reply({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
flags: MessageFlags.Ephemeral,
});
}
async function handleSetupApps(interaction) {
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const cfg = getGuildConfig(interaction.guildId);
setupSessions.set(sessionKey, {
type: "apps",
guildId: interaction.guildId,
appTypes: cfg.appTypes ? cfg.appTypes.map(a => ({ ...a })) : [],
expandedApp: null,
});
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: MessageFlags.Ephemeral });
return interaction.reply({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
flags: MessageFlags.Ephemeral,
});
}
// ─────────────────────────────────────────────────────────────
// BUTTON HANDLER (called from handleButton)
// ─────────────────────────────────────────────────────────────

async function handleSetupButton(interaction) {
const cid = interaction.customId;
// ══ TICKET BUTTONS ══════════════════════════════════════════
if (cid.startsWith("tsetup_")) {
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setuptickets` again.")], flags: MessageFlags.Ephemeral });
// Toggle expand/collapse
if (cid.startsWith("tsetup_toggle_")) {
const idx = parseInt(cid.replace("tsetup_toggle_", ""));
session.expandedTicket = session.expandedTicket === idx ? null : idx;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// Add new button → modal (name + welcome message only)
if (cid === "tsetup_add") {
if (session.ticketButtons.length >= 7) {
return interaction.reply({ embeds: [errorEmbed("Maximum 7 buttons reached.")], flags: MessageFlags.Ephemeral });
}
const idx = session.ticketButtons.length;
return interaction.showModal(
new ModalBuilder()
.setCustomId("tsetup_modal_add_" + idx)
.setTitle("Add Ticket Button " + (idx + 1))
.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("t_name")
.setLabel("Button Name (shown on the ticket panel)")
.setStyle(TextInputStyle.Short)
.setPlaceholder("e.g. Support, Partnership, Spawner")
.setRequired(true)
.setMaxLength(40)
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("t_description")
.setLabel("Welcome message shown inside the ticket")
.setStyle(TextInputStyle.Paragraph)
.setPlaceholder("e.g. Thanks for opening a ticket! Staff will be with you shortly.")
.setRequired(true)
.setMaxLength(500)

),
)
);
}
// Edit existing button → modal pre-filled
if (cid.startsWith("tsetup_edit_")) {
const idx = parseInt(cid.replace("tsetup_edit_", ""));
const btn = session.ticketButtons[idx];
if (!btn) return interaction.reply({ embeds: [errorEmbed("Button not found.")], flags: MessageFlags.Ephemeral });
return interaction.showModal(
new ModalBuilder()
.setCustomId("tsetup_modal_edit_" + idx)
.setTitle("Edit Button " + (idx + 1) + ": " + btn.name.slice(0, 30))
.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("t_name")
.setLabel("Button Name")
.setStyle(TextInputStyle.Short)
.setRequired(true)
.setMaxLength(40)
.setValue(btn.name || "")
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("t_description")
.setLabel("Welcome message inside the ticket")
.setStyle(TextInputStyle.Paragraph)
.setRequired(true)
.setMaxLength(500)
.setValue(btn.description || "")
),
)
);
}
// Color picker → modal
if (cid.startsWith("tsetup_color_")) {
const idx = parseInt(cid.replace("tsetup_color_", ""));
const btn = session.ticketButtons[idx];
if (!btn) return interaction.reply({ embeds: [errorEmbed("Button not found.")], flags: MessageFlags.Ephemeral });
return interaction.showModal(
new ModalBuilder()
.setCustomId("tsetup_modal_color_" + idx)
.setTitle("Button Color — " + (btn.name || "Button " + (idx + 1)))
.addComponents(

new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("t_color")
.setLabel("Button color: Blue / Green / Red / Grey")
.setStyle(TextInputStyle.Short)
.setPlaceholder("Blue")
.setRequired(false)
.setMaxLength(10)
.setValue(btn.color || "Blue")
),
)
);
}
// Delete
if (cid.startsWith("tsetup_delete_")) {
const idx = parseInt(cid.replace("tsetup_delete_", ""));
session.ticketButtons.splice(idx, 1);
session.expandedTicket = null;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// Save
if (cid === "tsetup_save") {
const cfg = getGuildConfig(interaction.guildId);
cfg.ticketTypes = session.ticketButtons.length === 0 ? null : session.ticketButtons.map(b => ({
name: b.name,
prefix: b.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
categoryId: b.categoryId || null,
description: b.description || "",
pingRoleIds: b.pingRoleIds || [],
viewerRoleIds: b.viewerRoleIds || [],
color: b.color || "Blue",
}));
setupSessions.delete(sessionKey);
const summary = cfg.ticketTypes
? cfg.ticketTypes.map((t, i) => (i + 1) + ". **" + t.name + "** → " + (t.categoryId ? "<#" + t.categoryId + ">" : "no category")).join("\n")
: "Reset to defaults.";
return interaction.update({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Ticket Setup Saved!")
.setDescription("Your ticket buttons have been saved:\n\n" + summary + "\n\nRun `/ticketpanelsend` to post the updated panel.")

.setTimestamp(),
],
components: [],
});
}
}
// ══ APP BUTTONS ═════════════════════════════════════════════
if (cid.startsWith("asetup_")) {
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setupapps` again.")], flags: MessageFlags.Ephemeral });
if (cid.startsWith("asetup_toggle_")) {
const idx = parseInt(cid.replace("asetup_toggle_", ""));
session.expandedApp = session.expandedApp === idx ? null : idx;
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
});
}
if (cid === "asetup_add") {
if (session.appTypes.length >= 5) {
return interaction.reply({ embeds: [errorEmbed("Maximum 5 application types reached.")], flags: MessageFlags.Ephemeral });
}
const idx = session.appTypes.length;
return interaction.showModal(
new ModalBuilder()
.setCustomId("asetup_modal_add_" + idx)
.setTitle("Add Application Type " + (idx + 1))
.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("a_name")
.setLabel("Application Name (shown on panel button)")
.setStyle(TextInputStyle.Short)
.setPlaceholder("e.g. Staff, Partner Manager, Builder")
.setRequired(true)
.setMaxLength(40)
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("a_questions")
.setLabel("Questions — one per line (up to 10)")
.setStyle(TextInputStyle.Paragraph)
.setPlaceholder("How old are you?\nWhat is your IGN?\nWhy do you want this role?")

.setRequired(true)
.setMaxLength(2000)
),
)
);
}
if (cid.startsWith("asetup_edit_")) {
const idx = parseInt(cid.replace("asetup_edit_", ""));
const app = session.appTypes[idx];
if (!app) return interaction.reply({ embeds: [errorEmbed("App not found.")], flags: MessageFlags.Ephemeral });
return interaction.showModal(
new ModalBuilder()
.setCustomId("asetup_modal_edit_" + idx)
.setTitle("Edit Questions — " + app.name.slice(0, 30))
.addComponents(
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("a_name")
.setLabel("Application Name")
.setStyle(TextInputStyle.Short)
.setRequired(true)
.setMaxLength(40)
.setValue(app.name || "")
),
new ActionRowBuilder().addComponents(
new TextInputBuilder()
.setCustomId("a_questions")
.setLabel("Questions — one per line (up to 10)")
.setStyle(TextInputStyle.Paragraph)
.setRequired(true)
.setMaxLength(2000)
.setValue((app.questions || []).join("\n"))
),
)
);
}
if (cid.startsWith("asetup_delete_")) {
const idx = parseInt(cid.replace("asetup_delete_", ""));
session.appTypes.splice(idx, 1);
session.expandedApp = null;
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
});
}

if (cid === "asetup_save") {
const cfg = getGuildConfig(interaction.guildId);
cfg.appTypes = session.appTypes.length === 0 ? null : session.appTypes.map(a => ({ ...a }));
setupSessions.delete(sessionKey);
const summary = cfg.appTypes
? cfg.appTypes.map((a, i) => (i + 1) + ". **" + a.name + "** → " + (a.questions?.length || 0) + " questions").join("\n")
: "Reset to defaults.";
return interaction.update({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Application Setup Saved!")
.setDescription("Your application types have been saved:\n\n" + summary + "\n\nRun `/applicationpanelsend` to post the updated panel.")
.setTimestamp(),
],
components: [],
});
}
}
return false;
}
// ─────────────────────────────────────────────────────────────
// SELECT MENU HANDLER (called from handleSelectMenu)
// ─────────────────────────────────────────────────────────────
async function handleSetupSelect(interaction) {
const cid = interaction.customId;
// ── Welcome: channel select ─────────────────────────────────
if (cid === "setupwelcome_channel") {
if (!interaction.values?.length) return interaction.update({});
const cfg = getGuildConfig(interaction.guildId);
cfg.welcomeChannelId = interaction.values[0];
return interaction.update({
embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(" Welcome Setup")
.setDescription("Channel set to <#" + cfg.welcomeChannelId + ">.\nEnabled: " + (cfg.welcomeEnabled ? " Yes" : " No") + "\n\nUse the buttons below to enable/disable.")
.setTimestamp()],
components: [
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupwelcome_channel")
.setPlaceholder(" Pick the welcome channel")
.addChannelTypes(ChannelType.GuildText)
),

new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId("setupwelcome_enable").setLabel(" Enable Welcomes").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId("setupwelcome_disable").setLabel(" Disable Welcomes").setStyle(ButtonStyle.Danger),
),
],
});
}
// ── Vouch: channel select ───────────────────────────────────
if (cid === "setupvouch_channel") {
if (!interaction.values?.length) return interaction.update({});
const cfg = getGuildConfig(interaction.guildId);
cfg.vouchChannelId = interaction.values[0];
return interaction.update({
embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(" Vouch Setup Saved")
.setDescription("Vouch channel set to <#" + cfg.vouchChannelId + ">.")
.setTimestamp()],
components: [],
});
}
// ── Setuproles: staff role ──────────────────────────────────
if (cid === "setuproles_staff") {
const cfg = getGuildConfig(interaction.guildId);
cfg.staffRoleId = interaction.values[0] ?? null;
return interaction.update(buildRolesSetupMessage(interaction.guild, getGuildConfig(interaction.guildId)));
}
if (cid === "setuproles_helper") {
const cfg = getGuildConfig(interaction.guildId);
cfg.helperRoleId = interaction.values[0] ?? null;
return interaction.update(buildRolesSetupMessage(interaction.guild, getGuildConfig(interaction.guildId)));
}
if (cid === "setuproles_pm") {
const cfg = getGuildConfig(interaction.guildId);
cfg.pmRoleId = interaction.values[0] ?? null;
return interaction.update(buildRolesSetupMessage(interaction.guild, getGuildConfig(interaction.guildId)));
}
if (cid === "setuproles_ticketstaff") {
const cfg = getGuildConfig(interaction.guildId);
cfg.ticketStaffRoleId = interaction.values[0] ?? null;
return interaction.update(buildRolesSetupMessage(interaction.guild, getGuildConfig(interaction.guildId)));
}
if (cid === "setuproles_staffappschan") {
const cfg = getGuildConfig(interaction.guildId);
cfg.staffAppChannelId = interaction.values[0] ?? null;
return interaction.update(buildRolesSetupMessage(interaction.guild, getGuildConfig(interaction.guildId)));
}

// ── Setupchannels: vouch ───────────────────────────────────
if (cid === "setupchannels_vouch") {
if (!interaction.values?.length) return interaction.update({});
const cfg = getGuildConfig(interaction.guildId);
cfg.vouchChannelId = interaction.values[0];
return interaction.update({
embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(" Channel Setup")
.setDescription(" Vouch channel set to <#" + cfg.vouchChannelId + ">\n Partner Channel: " + (cfg.partnerChannelId ? "<#" + cfg.partnerChannelId + ">" : "not set")).setTimestamp()],
components: [
new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("setupchannels_vouch").setPlaceholder(" Vouch channel").addChannelTypes(ChannelType.GuildText)),
new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("setupchannels_partner").setPlaceholder(" Partner channel").addChannelTypes(ChannelType.GuildText)),
],
});
}
// ── Setupchannels: partner ─────────────────────────────────
if (cid === "setupchannels_partner") {
if (!interaction.values?.length) return interaction.update({});
const cfg = getGuildConfig(interaction.guildId);
cfg.partnerChannelId = interaction.values[0];
return interaction.update({
embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(" Channel Setup")
.setDescription(" Vouch: " + (cfg.vouchChannelId ? "<#" + cfg.vouchChannelId + ">" : "not set") + "\n Partner channel set to <#" + cfg.partnerChannelId + ">").setTimestamp()],
components: [
new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("setupchannels_vouch").setPlaceholder(" Vouch channel").addChannelTypes(ChannelType.GuildText)),
new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("setupchannels_partner").setPlaceholder(" Partner channel").addChannelTypes(ChannelType.GuildText)),
],
});
}
if (cid.startsWith("tsetup_cat_")) {
const idx = parseInt(cid.replace("tsetup_cat_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setuptickets` again.")], flags: MessageFlags.Ephemeral });
session.ticketButtons[idx].categoryId = interaction.values[0] ?? null;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// ── Ticket: ping roles ──────────────────────────────────────
if (cid.startsWith("tsetup_pingroles_")) {

const idx = parseInt(cid.replace("tsetup_pingroles_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired.")], flags: MessageFlags.Ephemeral });
session.ticketButtons[idx].pingRoleIds = interaction.values;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// ── Ticket: viewer roles ────────────────────────────────────
if (cid.startsWith("tsetup_viewerroles_")) {
const idx = parseInt(cid.replace("tsetup_viewerroles_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired.")], flags: MessageFlags.Ephemeral });
session.ticketButtons[idx].viewerRoleIds = interaction.values;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// ── App: review channel ─────────────────────────────────────
if (cid.startsWith("asetup_channel_")) {
const idx = parseInt(cid.replace("asetup_channel_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setupapps` again.")], flags: MessageFlags.Ephemeral });
session.appTypes[idx].channelId = interaction.values[0] ?? null;
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
});
}
// ── App: role on accept ─────────────────────────────────────
if (cid.startsWith("asetup_role_")) {
const idx = parseInt(cid.replace("asetup_role_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired.")], flags: MessageFlags.Ephemeral });
session.appTypes[idx].roleId = interaction.values[0] ?? null;
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),

});
}
// ── App: required role to apply ─────────────────────────────
if (cid.startsWith("asetup_requiredrole_")) {
const idx = parseInt(cid.replace("asetup_requiredrole_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired.")], flags: MessageFlags.Ephemeral });
session.appTypes[idx].requiredRoleId = interaction.values[0] ?? null;
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
});
}
return false;
}
// ─────────────────────────────────────────────────────────────
// MODAL HANDLER (called from interactionCreate)
// ─────────────────────────────────────────────────────────────
async function handleSetupModal(interaction) {
const cid = interaction.customId;
// ── Ticket: name + welcome message ──────────────────────────
if (cid.startsWith("tsetup_modal_add_") || cid.startsWith("tsetup_modal_edit_")) {
const isEdit = cid.startsWith("tsetup_modal_edit_");
const idx = parseInt(cid.replace(isEdit ? "tsetup_modal_edit_" : "tsetup_modal_add_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setuptickets` again.")], flags: MessageFlags.Ephemeral });
const name = interaction.fields.getTextInputValue("t_name").trim();
const description = interaction.fields.getTextInputValue("t_description").trim();
if (isEdit) {
session.ticketButtons[idx] = { ...session.ticketButtons[idx], name, description };
session.expandedTicket = idx;
} else {
session.ticketButtons.push({ name, description, categoryId: null, pingRoleIds: [], viewerRoleIds: [], color: "Blue" });
session.expandedTicket = session.ticketButtons.length - 1;
}
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],

components: buildTicketSetupRows(session, interaction.guild),
});
}
// ── Ticket: color ────────────────────────────────────────────
if (cid.startsWith("tsetup_modal_color_")) {
const idx = parseInt(cid.replace("tsetup_modal_color_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_tickets";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired.")], flags: MessageFlags.Ephemeral });
const colorRaw = interaction.fields.getTextInputValue("t_color").trim().toLowerCase();
const colorMap = { blue: "Blue", green: "Green", red: "Red", grey: "Grey", gray: "Grey" };
const color = colorMap[colorRaw] || "Blue";
session.ticketButtons[idx].color = color;
return interaction.update({
embeds: [buildTicketSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildTicketSetupRows(session, interaction.guild),
});
}
// ── App: name + questions ────────────────────────────────────
if (cid.startsWith("asetup_modal_add_") || cid.startsWith("asetup_modal_edit_")) {
const isEdit = cid.startsWith("asetup_modal_edit_");
const idx = parseInt(cid.replace(isEdit ? "asetup_modal_edit_" : "asetup_modal_add_", ""));
const sessionKey = interaction.user.id + "_" + interaction.guildId + "_apps";
const session = setupSessions.get(sessionKey);
if (!session) return interaction.reply({ embeds: [errorEmbed("Session expired — run `/setupapps` again.")], flags: MessageFlags.Ephemeral });
const name = interaction.fields.getTextInputValue("a_name").trim();
const questions = interaction.fields.getTextInputValue("a_questions")
.split("\n").map(q => q.trim()).filter(Boolean).slice(0, 10);
if (isEdit) {
session.appTypes[idx] = { ...session.appTypes[idx], name, questions };
session.expandedApp = idx;
} else {
session.appTypes.push({ name, questions, channelId: null, roleId: null, requiredRoleId: null });
session.expandedApp = session.appTypes.length - 1;
}
return interaction.update({
embeds: [buildAppSetupEmbed(session, interaction.guild?.name ?? "this server")],
components: buildAppSetupRows(session),
});
}

return false;
}

// ============================================================
// index.js — Part 3: Giveaway, Dork Game, Ready, Login
// ============================================================
// ============================================================
// GIVEAWAY HANDLER
// ============================================================
async function handleGiveaway(interaction) {
const sub = interaction.options.getSubcommand();
// ── /giveaway normal — regular giveaway, just picks a winner ──
if (sub === "normal") {
const prize = interaction.options.getString("prize");
const durStr = interaction.options.getString("duration");
const description = interaction.options.getString("description") ?? null;
const durationMs = parseDuration(durStr);
if (isNaN(durationMs) || durationMs <= 0) {
return interaction.reply({
embeds: [errorEmbed("Invalid duration. Use formats like `30m`, `1h`, `2d`.")],
flags: MessageFlags.Ephemeral,
});
}
const endsAt = Date.now() + durationMs;
const winnerCount = interaction.options.getInteger("winners") ?? 1;
const giveawayData = {
prize,
description,
maxPrize: null,
isDork: false,
winnerCount,
endsAt,
hostId: interaction.user.id,
channelId: interaction.channelId,
guildId: interaction.guildId,
entries: [],
};
const joinBtn = new ButtonBuilder()

.setCustomId("giveaway_join")
.setLabel("Enter Giveaway")
.setStyle(ButtonStyle.Primary);
const row = new ActionRowBuilder().addComponents(joinBtn);
await interaction.reply({ content: " Giveaway created!", flags: MessageFlags.Ephemeral });
const msg = await interaction.channel.send({
embeds: [buildGiveawayEmbed(giveawayData)],
components: [row],
});
giveawayData.messageId = msg.id;
activeGiveaways.set(msg.id, giveawayData);
const normalKey = `${interaction.guildId}:${interaction.user.id}`;
const prevCount = giveawayHostCounts.get(normalKey) ?? { count: 0, timestamps: [] };
prevCount.count += 1;
prevCount.timestamps = [...(prevCount.timestamps || []), Date.now()];
giveawayHostCounts.set(normalKey, prevCount);
setTimeout(() => endGiveaway(msg.id, interaction.channel), durationMs);
}
// ── /giveaway dork — giveaway with dork doubling game ─────
if (sub === "dork") {
const prizeStr = interaction.options.getString("prize");
const durStr = interaction.options.getString("duration");
const maxPrizeStr = interaction.options.getString("maxprize");
const description = interaction.options.getString("description") ?? null;
const prize = parseNumber(prizeStr);
if (isNaN(prize) || prize <= 0) {
return interaction.reply({
embeds: [errorEmbed("Invalid prize. Use a number like `1m`, `500k`, `1b`.")],
flags: MessageFlags.Ephemeral,
});
}
const durationMs = parseDuration(durStr);
if (isNaN(durationMs) || durationMs <= 0) {
return interaction.reply({
embeds: [errorEmbed("Invalid duration. Use formats like `30m`, `1h`, `2d`.")],
flags: MessageFlags.Ephemeral,
});
}
const maxPrize = parseNumber(maxPrizeStr);

if (isNaN(maxPrize) || maxPrize <= 0) {
return interaction.reply({
embeds: [errorEmbed("Invalid max prize cap. Use a number like `10m`, `500k`, `1b`.")],
flags: MessageFlags.Ephemeral,
});
}
const endsAt = Date.now() + durationMs;
const giveawayData = {
prize,
description,
maxPrize,
isDork: true,
endsAt,
hostId: interaction.user.id,
channelId: interaction.channelId,
entries: [],
};
const joinBtn = new ButtonBuilder()
.setCustomId("giveaway_join")
.setLabel("Enter Giveaway")
.setStyle(ButtonStyle.Primary);
const row = new ActionRowBuilder().addComponents(joinBtn);
await interaction.reply({ content: " Dork giveaway created!", flags: MessageFlags.Ephemeral });
const msg = await interaction.channel.send({
embeds: [buildGiveawayEmbed(giveawayData)],
components: [row],
});
giveawayData.messageId = msg.id;
activeGiveaways.set(msg.id, giveawayData);
const dorkKey = `${interaction.guildId}:${interaction.user.id}`;
const dorkPrev = giveawayHostCounts.get(dorkKey) ?? { count: 0, timestamps: [] };
dorkPrev.count += 1;
dorkPrev.timestamps = [...(dorkPrev.timestamps || []), Date.now()];
giveawayHostCounts.set(dorkKey, dorkPrev);
setTimeout(() => endGiveaway(msg.id, interaction.channel), durationMs);
}
// ── /giveaway end ──────────────────────────────────────────
if (sub === "end") {
const messageId = interaction.options.getString("messageid").trim();

if (!activeGiveaways.has(messageId)) {
return interaction.reply({
embeds: [errorEmbed("No active giveaway found with that message ID.")],
flags: MessageFlags.Ephemeral,
});
}
await interaction.reply({ content: " Ending giveaway...", flags: MessageFlags.Ephemeral });
await endGiveaway(messageId, interaction.channel);
}
// ── /giveaway track ────────────────────────────────────────
if (sub === "track") {
const target = interaction.options.getUser("user") ?? interaction.user;
const key = `${interaction.guildId}:${target.id}`;
const count = giveawayHostCounts.get(key) ?? 0;
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle("Giveaway Track")
.setDescription(`<@${target.id}> has hosted **${count}** giveaway${count === 1 ? "" : "s"} in this server.`)
.setTimestamp(),
],
});
}
// ── /giveaway leaderboard ──────────────────────────────────
if (sub === "leaderboard") {
const guildPrefix = `${interaction.guildId}:`;
// Filter to entries belonging to this guild only
const guildEntries = [...giveawayHostCounts.entries()]
.filter(([key]) => key.startsWith(guildPrefix))
.map(([key, count]) => [key.replace(guildPrefix, ""), count]); // strip prefix to get userId
if (guildEntries.length === 0) {
return interaction.reply({
embeds: [errorEmbed("No giveaways have been hosted in this server yet.")],
flags: MessageFlags.Ephemeral,
});
}
const sorted = guildEntries.sort((a, b) => b[1] - a[1]).slice(0, 10);
const medals = [" ", " ", " "];

const lines = sorted.map(([userId, count], i) =>
`${medals[i] ?? `**${i + 1}.**`} <@${userId}> — **${count}** giveaway${count === 1 ? "" : "s"}`
);
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x1e40af)
.setTitle("Giveaway Leaderboard")
.setDescription(lines.join("\n"))
.setTimestamp(),
],
});
}
}
// ============================================================
// END GIVEAWAY LOGIC (used by both auto-timer and /giveaway end)
// ============================================================
async function endGiveaway(messageId, channel) {
const data = activeGiveaways.get(messageId);
if (!data) return; // already ended or never existed
// Remove from active map immediately to prevent double-ending
activeGiveaways.delete(messageId);
// Fetch the original giveaway message
let giveawayMsg;
try {
giveawayMsg = await channel.messages.fetch(messageId);
} catch {
console.error(` Could not fetch giveaway message ${messageId}`);
return;
}
// Disable the join button on the original message
const disabledBtn = new ButtonBuilder()
.setCustomId("giveaway_join")
.setLabel(" Giveaway Ended")
.setStyle(ButtonStyle.Secondary)
.setDisabled(true);
const disabledRow = new ActionRowBuilder().addComponents(disabledBtn);
// Build ended embed
const endedEmbed = new EmbedBuilder()

.setColor(0x95a5a6)
.setTitle(" GIVEAWAY ENDED ")
.setDescription(
`**${data.prize}**` +
(data.description ? `\n${data.description}` : "") +
`\n\n Host: <@${data.hostId}>` +
`\n Total Entries: **${data.entries.length}**`
)
.setTimestamp();
await giveawayMsg.edit({ embeds: [endedEmbed], components: [disabledRow] });
// No entries — end with no winner
if (data.entries.length === 0) {
return channel.send({
embeds: [
new EmbedBuilder()
.setColor(0x95a5a6)
.setTitle(" Giveaway Ended")
.setDescription(`No one entered the giveaway for **${data.prize}**. No winner selected.`)
.setTimestamp(),
],
});
}
// Pick random winners (no duplicates)
const winnerCount = data.winnerCount ?? 1;
const shuffled = [...data.entries].sort(() => Math.random() - 0.5);
const winnerIds = shuffled.slice(0, Math.min(winnerCount, shuffled.length));
// Normal giveaway (no dork) — announce winners directly
if (data.maxPrize === null) {
const mentions = winnerIds.map(id => `<@${id}>`).join(", ");
const lines = winnerIds.map((id, i) => ` Winner ${i + 1}: <@${id}>`).join("\n");
return channel.send({
content: mentions,
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(` Giveaway Winner${winnerIds.length > 1 ? "s" : ""}!`)
.setDescription(
`Congratulations! \n\n${lines}\n\n` +
`**Prize:** ${data.prize}\n` +
`Please contact <@${data.hostId}> to claim your prize.`
)
.setTimestamp(),
],

});
}
// Dork giveaway — start the doubling game for first winner only
await startDorkGame(channel, winnerIds[0], data.prize, data.maxPrize);
}
// ============================================================
// DORK GAME — START
// ============================================================
async function startDorkGame(channel, winnerId, prize, maxPrize) {
const dorkId = `${winnerId}_${Date.now()}`;
const doubled = typeof prize === "number" ? prize * 2 : null;
// Detect if prize is a numeric value or a text prize
// For the dork game, prize starts as text on first round,
// then becomes a number when doubling begins
const isNumeric = typeof prize === "number";
const displayPrize = isNumeric ? formatNumber(prize) : prize;
const dorkData = {
winnerId,
prize, // current prize (string on first round, number after first double)
maxPrize,
channelId: channel.id,
};
const dorkEmbed = new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(" Dork Game")
.setDescription(
`<@${winnerId}> won the giveaway!\n\n` +
` **Prize: ${displayPrize}**\n\n` +
`Do you want to **keep** your prize, or **double** it?\n` +
(isNumeric && doubled > maxPrize
? ` Doubling would exceed the max cap of **${formatNumber(maxPrize)}**. You can only keep.`
: `> If you double and win, you get **${isNumeric ? formatNumber(doubled) : "double the prize"}**!`)
)
.setFooter({ text: `Max prize cap: ${formatNumber(maxPrize)}` })
.setTimestamp();
const row = buildDorkRow(isNumeric ? prize : 0, maxPrize, dorkId, !isNumeric);
const dorkMsg = await channel.send({
content: `<@${winnerId}>`,
embeds: [dorkEmbed],

components: [row],
});
dorkData.messageId = dorkMsg.id;
activeDorks.set(dorkMsg.id, dorkData);
}
// ============================================================
// BUTTON HANDLER (giveaway join + dork keep/double)
// ============================================================
async function handleButton(interaction) {
const { customId } = interaction;
// ── Setup system buttons ──────────────────────────────────
if (customId.startsWith("tsetup_") || customId.startsWith("asetup_")) {
return handleSetupButton(interaction);
}
// ── Split or Steal DM buttons ────────────────────────────────
if (customId.startsWith("sos_split_") || customId.startsWith("sos_steal_")) {
const choice = customId.startsWith("sos_split_") ? "split" : "steal";
const userId = customId.replace("sos_split_", "").replace("sos_steal_", "");
const session = splitOrStealSessions.get(userId);
if (!session) {
return interaction.update({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(" Expired").setDescription("This giveaway session has already ended.").setTimestamp()], components: [] });
}
if (interaction.user.id !== userId) {
return interaction.reply({ embeds: [errorEmbed("This is not your giveaway choice.")], flags: MessageFlags.Ephemeral });
}
await session.respond(choice);
return;
}
// ── Welcome enable / disable ───────────────────────────────
if (customId === "setupwelcome_enable" || customId === "setupwelcome_disable") {
const cfg = getGuildConfig(interaction.guildId);
cfg.welcomeEnabled = customId === "setupwelcome_enable";
const status = cfg.welcomeEnabled ? " Enabled" : " Disabled";
return interaction.update({
embeds: [new EmbedBuilder()
.setColor(cfg.welcomeEnabled ? 0x2ecc71 : 0xe74c3c)
.setTitle(" Welcome Setup")
.setDescription(
"**Current config:**\n" +
"Channel: " + (cfg.welcomeChannelId ? "<#" + cfg.welcomeChannelId + ">" : "not set") + "\n" +
"Enabled: " + status + "\n\n" +

"Welcome messages are now **" + (cfg.welcomeEnabled ? "enabled" : "disabled") + "**."
)
.setTimestamp()],
components: [
new ActionRowBuilder().addComponents(
new ChannelSelectMenuBuilder()
.setCustomId("setupwelcome_channel")
.setPlaceholder(" Pick the welcome channel")
.addChannelTypes(ChannelType.GuildText)
),
new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId("setupwelcome_enable").setLabel(" Enable Welcomes").setStyle(cfg.welcomeEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
new ButtonBuilder().setCustomId("setupwelcome_disable").setLabel(" Disable Welcomes").setStyle(!cfg.welcomeEnabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
),
],
});
}
// ── Giveaway Join Button ───────────────────────────────────
if (customId === "giveaway_join") {
// Find which giveaway this button belongs to by message ID
const messageId = interaction.message.id;
const data = activeGiveaways.get(messageId);
if (!data) {
return interaction.reply({
embeds: [errorEmbed("This giveaway has already ended.")],
flags: MessageFlags.Ephemeral,
});
}
if (data.entries.includes(interaction.user.id)) {
return interaction.reply({
embeds: [errorEmbed("You have already entered this giveaway!")],
flags: MessageFlags.Ephemeral,
});
}
// Add entry
data.entries.push(interaction.user.id);
activeGiveaways.set(messageId, data);
// Update the giveaway embed to reflect new entry count
await interaction.message.edit({ embeds: [buildGiveawayEmbed(data)] });
return interaction.reply({
embeds: [

new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Entered!")
.setDescription(`You've entered the giveaway for **${data.prize}**! Good luck!`)
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
// ── Dork Keep Button ──────────────────────────────────────
if (customId.startsWith("dork_keep_")) {
const dorkId = customId.replace("dork_keep_", "");
const messageId = interaction.message.id;
const data = activeDorks.get(messageId);
if (!data) {
return interaction.reply({
embeds: [errorEmbed("This dork session has already ended.")],
flags: MessageFlags.Ephemeral,
});
}
// Only the winner can interact
if (interaction.user.id !== data.winnerId) {
return interaction.reply({
embeds: [errorEmbed("Only the giveaway winner can make this choice.")],
flags: MessageFlags.Ephemeral,
});
}
// Remove from active dorks
activeDorks.delete(messageId);
// Disable all buttons on the dork message
const disabledKeep = new ButtonBuilder()
.setCustomId(`dork_keep_${dorkId}`)
.setLabel(" Keep")
.setStyle(ButtonStyle.Success)
.setDisabled(true);
const disabledDouble = new ButtonBuilder()
.setCustomId(`dork_double_${dorkId}`)
.setLabel(" Double")
.setStyle(ButtonStyle.Danger)
.setDisabled(true);

const disabledRow = new ActionRowBuilder().addComponents(disabledKeep, disabledDouble);
await interaction.message.edit({ components: [disabledRow] });
const displayPrize = typeof data.prize === "number"
? formatNumber(data.prize)
: data.prize;
// Send keep result
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Winner Chose Keep!")
.setDescription(`<@${data.winnerId}> chose keep and won **${displayPrize}**! Congratulations! `)
.setTimestamp(),
],
});
}
// ── Application Panel Buttons ────────────────────────────
if (customId === "app_staff") return startApplicationFlow(interaction, "staff");
if (customId === "app_pm") return startApplicationFlow(interaction, "pm");
if (customId.startsWith("app_custom_")) return startApplicationFlow(interaction, customId);
// ── Application Accept Button ─────────────────────────────
if (customId.startsWith("accept_app_")) {
const rest = customId.replace("accept_app_", "");
const userId = rest.match(/^(\d+)_/)?.[1];
const appType = userId ? rest.slice(userId.length + 1) : null;
if (!userId || !appType) return interaction.reply({ embeds: [errorEmbed("Invalid button data.")], flags: MessageFlags.Ephemeral });
return handleAppAccept(interaction, userId, appType);
}
// ── Application Deny Button ───────────────────────────────
if (customId.startsWith("deny_app_")) {
const rest = customId.replace("deny_app_", "");
const userId = rest.match(/^(\d+)_/)?.[1];
const appType = userId ? rest.slice(userId.length + 1) : null;
if (!userId || !appType) return interaction.reply({ embeds: [errorEmbed("Invalid button data.")], flags: MessageFlags.Ephemeral });
return handleAppDeny(interaction, userId, appType);
}
// ── Ticket Buttons ───────────────────────────────────────
const defaultTicketTypes = ["support","giveaway","spawner","partnership","report_member","report_staff","building","mysterybox"];
for (const t of defaultTicketTypes) {
if (customId === `ticket_${t}`) {
return handleTicketCreate(interaction, t);

}
}
// Custom ticket types from /ticketsetup
if (customId.startsWith("ticket_custom_")) {
const typeName = decodeURIComponent(customId.replace("ticket_custom_", ""));
return handleTicketCreate(interaction, typeName, true);
}
// ── Ticket Close Button ───────────────────────────────────
if (customId.startsWith("ticket_close_")) {
const channelId = customId.replace("ticket_close_", "");
return handleTicketClose(interaction, channelId);
}
// ── Dork Double Button ────────────────────────────────────
if (customId.startsWith("dork_double_")) {
const dorkId = customId.replace("dork_double_", "");
const messageId = interaction.message.id;
const data = activeDorks.get(messageId);
if (!data) {
return interaction.reply({
embeds: [errorEmbed("This dork session has already ended.")],
flags: MessageFlags.Ephemeral,
});
}
// Only the winner can interact
if (interaction.user.id !== data.winnerId) {
return interaction.reply({
embeds: [errorEmbed("Only the giveaway winner can make this choice.")],
flags: MessageFlags.Ephemeral,
});
}
// Calculate new prize
// On first double, if prize is still a string, we treat maxPrize as the base to double
// This handles text prizes — we switch to numeric doubling from maxPrize context
let currentNumeric;
if (typeof data.prize === "number") {
currentNumeric = data.prize;
} else {
// First double — we need a numeric base. Use maxPrize / some reasonable factor.
// Since prize is text, we note the doubled prize as "2x [prize]" concept.
// DESIGN DECISION: if the prize is text (not a number), disable double entirely.
// This is caught at buildDorkRow already (prize = 0 for text), so this path
// is a safety fallback.

return interaction.reply({
embeds: [errorEmbed("This prize cannot be doubled as it is not a numeric value.")],
flags: MessageFlags.Ephemeral,
});
}
const newPrize = currentNumeric * 2;
// Safety check — should never hit since button is disabled, but belt-and-suspenders
if (newPrize > data.maxPrize) {
return interaction.reply({
embeds: [errorEmbed(`Doubling would exceed the max cap of **${formatNumber(data.maxPrize)}**. You can only keep.`)],
flags: MessageFlags.Ephemeral,
});
}
// Remove old dork session
activeDorks.delete(messageId);
// Disable buttons on old message
const disabledKeep = new ButtonBuilder()
.setCustomId(`dork_keep_${dorkId}`)
.setLabel(" Keep")
.setStyle(ButtonStyle.Success)
.setDisabled(true);
const disabledDouble = new ButtonBuilder()
.setCustomId(`dork_double_${dorkId}`)
.setLabel(" Double")
.setStyle(ButtonStyle.Danger)
.setDisabled(true);
const disabledRow = new ActionRowBuilder().addComponents(disabledKeep, disabledDouble);
await interaction.message.edit({ components: [disabledRow] });
// Acknowledge the interaction before sending new message
await interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0xf39c12)
.setTitle(" Doubling!")
.setDescription(`<@${data.winnerId}> chose to double! The prize is now **${formatNumber(newPrize)}**!`)
.setTimestamp(),
],
});
// Start a new dork round with the doubled prize (numeric this time)

await startDorkGame(interaction.channel, data.winnerId, newPrize, data.maxPrize);
}
}

// ============================================================
// index.js — API Part 1: DonutSMP API Helper + Command Routing
// ============================================================
// ── DonutSMP API helper ──────────────────────────────────────
// All API calls go through this function.
// Returns { ok: true, data } on success or { ok: false, message } on failure.
async function donutAPI(path, options = {}) {
const apiKey = process.env.DONUT_API_KEY;
if (!apiKey) return { ok: false, message: "Missing `DONUT_API_KEY` environment variable on Railway." };
const url = `https://api.donutsmp.net${path}`;
const headers = {
"Authorization": `Bearer ${apiKey}`,
"Content-Type": "application/json",
};
try {
const res = await fetch(url, { method: options.method || "GET", headers, body: options.body || undefined });
const json = await res.json();
if (res.status === 401) return { ok: false, message: "Invalid or missing API key. Check your `DONUT_API_KEY` on Railway." };
if (res.status === 500) return { ok: false, message: json.message || "The DonutSMP API could not handle this request. The player or item may not exist." };
if (!res.ok) return { ok: false, message: `API returned status ${res.status}.` };
return { ok: true, data: json };
} catch (err) {
console.error(" DonutSMP API fetch error:", err);
return { ok: false, message: "Could not reach the DonutSMP API. It may be down." };
}
}
// ── Helper: format playtime from seconds to readable string ──
function formatPlaytime(seconds) {
// API sometimes returns minutes instead of seconds - detect by magnitude
// If value is huge (> 10 years in seconds), treat as minutes
let s = Number(seconds);
if (isNaN(s)) return String(seconds);
// Heuristic: if s > 315360000 (10 years in seconds), likely minutes
if (s > 315360000) s = s * 60;
const d = Math.floor(s / 86400);
const h = Math.floor((s % 86400) / 3600);

if (d > 0) return h > 0 ? `${d} days ${h} hours` : `${d} days`;
const m = Math.floor((s % 3600) / 60);
if (h > 0) return m > 0 ? `${h} hours ${m} mins` : `${h} hours`;
return m > 0 ? `${m} mins` : "< 1 min";
}
// ── Helper: format time_left (seconds) to readable string ────
function formatTimeLeft(seconds) {
const s = Number(seconds);
if (isNaN(s) || s <= 0) return "Expired";
const d = Math.floor(s / 86400);
const h = Math.floor((s % 86400) / 3600);
const m = Math.floor((s % 3600) / 60);
if (d > 0) return `${d}d ${h}h`;
if (h > 0) return `${h}h ${m}m`;
return `${m}m`;
}
// ── Helper: format enchantments object to readable string ────
function formatEnchants(enchants) {
if (!enchants || !enchants.enchantments || !enchants.enchantments.levels) return null;
const levels = enchants.enchantments.levels;
const entries = Object.entries(levels);
if (!entries.length) return null;
return entries.map(([name, lvl]) => `${name} ${lvl}`).join(", ");
}
// ============================================================
// TICKET SYSTEM — Part 2 Functions
// ============================================================
// ============================================================
// APPLICATION SYSTEM — Ticket Part 3
// ============================================================
// ── Handler: /applicationpanelsend ───────────────────────────
async function handleApplicationPanelSend(interaction) {
const cfg = getGuildConfig(interaction.guildId);
const guildName = interaction.guild?.name ?? "this server";
// Use custom app types if configured, otherwise fall back to defaults
const useCustom = cfg.appTypes && cfg.appTypes.length > 0;
const appEntries = useCustom
? cfg.appTypes.slice(0, 5)
: [
{ name: "Staff", customId: "app_staff", style: ButtonStyle.Primary },
{ name: "Partner Manager", customId: "app_pm", style: ButtonStyle.Success },

];
const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(` Applications — ${guildName}`)
.setDescription(
`Feel free to apply for staff in **${guildName}** down below!\n\n` +
" **Requirements:**\n" +
"• You must be **14 years or older** to apply.\n" +
"• There is a **14-day cooldown** between applications.\n" +
"• You must have at least **250 million** on DonutSMP.\n" +
"• Do **not** ask about your application status — doing so will result in an **instant denial**.\n" +
"• Must have **2FA** enabled.\n\n" +
"Select the application type below."
)
.setFooter({ text: "Applications are reviewed by the management team." })
.setTimestamp();
const buttons = appEntries.map((t, i) =>
new ButtonBuilder()
.setCustomId(t.customId ?? `app_custom_${encodeURIComponent(t.name)}`)
.setLabel(t.name.slice(0, 80))
.setStyle(t.style ?? (i % 2 === 0 ? ButtonStyle.Primary : ButtonStyle.Success))
);
const row = new ActionRowBuilder().addComponents(...buttons);
await interaction.reply({ content: " Application panel sent!", flags: MessageFlags.Ephemeral });
return interaction.channel.send({ embeds: [embed], components: [row] });
}
// ── Start DM application flow ─────────────────────────────────
// Sends first question via DM and stores session in activeApplications
async function startApplicationFlow(interaction, type) {
const user = interaction.user;
const cfg = getGuildConfig(interaction.guildId);
const guildName = interaction.guild?.name ?? "this server";
// Resolve questions and label — custom types override defaults
let questions, label, reviewChannelId;
if (type === "staff") {
questions = STAFF_APP_QUESTIONS;
label = "Staff";
reviewChannelId = cfg.staffAppChannelId ?? process.env.STAFF_APP_CHANNEL_ID ?? null;
} else if (type === "pm") {
questions = PM_APP_QUESTIONS;
label = "Partner Manager";

reviewChannelId = cfg.pmAppChannelId ?? process.env.PM_APP_CHANNEL_ID ?? null;
} else {
// Custom app type from /appsetup
const customType = cfg.appTypes?.find(a => `app_custom_${encodeURIComponent(a.name)}` === type || a.name === type);
if (!customType) {
return interaction.reply({ embeds: [errorEmbed("Application type not found.")], flags: MessageFlags.Ephemeral });
}
questions = customType.questions;
label = customType.name;
reviewChannelId = customType.channelId ?? null;
}
// Check if user already has an active application session
if (activeApplications.has(user.id)) {
return interaction.reply({
embeds: [errorEmbed("You already have an active application in progress. Please check your DMs.")],
flags: MessageFlags.Ephemeral,
});
}
// Try to DM the user
let dmChannel;
try {
dmChannel = await user.createDM();
await dmChannel.send({
embeds: [
new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(` ${label} Application`)
.setDescription(
`Welcome! You are applying for **${label}** in **${guildName}**.\n\n` +
`Please answer each question by typing your response in this DM.\n` +
`There are **${questions.length} questions** in total.\n\n` +
`**Question 1 of ${questions.length}:**\n${questions[0]}`
)
.setFooter({ text: "Type your answer below. You have 5 minutes per question." })
.setTimestamp(),
],
});
} catch (err) {
return interaction.reply({
embeds: [errorEmbed(
"I couldn't send you a DM! Please enable Direct Messages from server members.\n\n" +
"**To fix:** Right-click the server → Privacy Settings → Allow direct messages from server members."
)],
flags: MessageFlags.Ephemeral,
});

}
// Store the session
activeApplications.set(user.id, {
type,
questions,
answers: [],
currentQ: 0,
guildId: interaction.guildId,
label,
reviewChannelId,
startedAt: Date.now(),
});
// Confirm to user in server (ephemeral)
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Application Started")
.setDescription("Check your DMs! Answer each question to complete your application.")
.setTimestamp(),
],
flags: MessageFlags.Ephemeral,
});
}
// ── messageCreate: handle DM application answers + partner tracking ──
client.on("messageCreate", async (message) => {
if (message.author.bot) return;
// ── Partner link tracking (guild messages only) ────────────
if (message.guild && message.channel.type === ChannelType.GuildText) {
const cfg = getGuildConfig(message.guild.id);
if (cfg.partnerChannelId && message.channelId === cfg.partnerChannelId) {
// Detect Discord invite links: discord.gg/xxx or discord.com/invite/xxx
const INVITE_REGEX = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/gi;
const matches = message.content.match(INVITE_REGEX);
if (matches && matches.length > 0) {
const links = partnerLinks.get(message.guild.id) ?? [];
for (const link of matches) {
links.push({ userId: message.author.id, link, timestamp: Date.now() });
}
partnerLinks.set(message.guild.id, links);
}
}
return; // Don't process guild messages for applications

}
// DM-only from here
if (message.channel.type !== ChannelType.DM) return;
const session = activeApplications.get(message.author.id);
if (!session) return; // Not in an active application
// Stale session guard — expire after 30 minutes of inactivity
if (Date.now() - session.startedAt > 30 * 60 * 1000) {
activeApplications.delete(message.author.id);
return message.channel.send({
embeds: [errorEmbed("Your application session has expired (30 minutes). Please start again.")],
});
}
// Save this answer
session.answers.push(message.content.trim());
session.currentQ++;
session.startedAt = Date.now(); // Reset inactivity timer
// If more questions remain, send the next one
if (session.currentQ < session.questions.length) {
const nextQ = session.questions[session.currentQ];
await message.channel.send({
embeds: [
new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(` ${session.label} Application`)
.setDescription(
`**Question ${session.currentQ + 1} of ${session.questions.length}:**\n${nextQ}`
)
.setFooter({ text: "Type your answer below." })
.setTimestamp(),
],
});
activeApplications.set(message.author.id, session);
return;
}
// All questions answered — submit the application
activeApplications.delete(message.author.id);
// Send confirmation to the applicant
await message.channel.send({
embeds: [
new EmbedBuilder()

.setColor(0x2ecc71)
.setTitle(" Application Submitted!")
.setDescription(
`Your **${session.label}** application has been submitted successfully!\n\n` +
`The management team will review it and get back to you. ` +
`Do **not** ask about your application status — doing so will result in an **instant denial**.`
)
.setTimestamp(),
],
});
// Fetch the submission channel — use reviewChannelId stored in session
const channelId = session.reviewChannelId ?? null;
if (!channelId) {
console.error(` No review channel configured for application type "${session.label}"`);
return;
}
let submitChannel;
try {
submitChannel = await client.channels.fetch(channelId);
} catch (err) {
console.error(" Could not fetch application submission channel:", err);
return;
}
if (!submitChannel) {
console.error(" Application submission channel not found");
return;
}
// Build the submission embed
const submissionEmbed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(` ${message.author.username}'s '${session.label}' Application Submitted`)
.setThumbnail(message.author.displayAvatarURL({ forceStatic: false }) ?? null)
.setTimestamp();
// Add each Q&A as a field
session.questions.forEach((q, i) => {
submissionEmbed.addFields({
name: `${i + 1}. ${q}`,
value: session.answers[i] || "No answer provided",
inline: false,
});
});

submissionEmbed.setFooter({ text: `User ID: ${message.author.id}` });
// Accept / Deny buttons
const actionRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`accept_app_${message.author.id}_${session.type}`)
.setLabel(" Accept")
.setStyle(ButtonStyle.Success),
new ButtonBuilder()
.setCustomId(`deny_app_${message.author.id}_${session.type}`)
.setLabel(" Deny")
.setStyle(ButtonStyle.Danger),
);
await submitChannel.send({
embeds: [submissionEmbed],
components: [actionRow],
});
});
// ── Handler: application accept ──────────────────────────────
async function handleAppAccept(interaction, userId, appType) {
if (!interaction.guild) {
return interaction.reply({ embeds: [errorEmbed("This can only be used in a server.")], flags: MessageFlags.Ephemeral });
}
// Defer immediately so Discord doesn't time out during role assignment
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
const guild = interaction.guild;
// Fetch the member
const member = await guild.members.fetch(userId).catch(() => null);
if (!member) {
return interaction.editReply({
embeds: [errorEmbed("Could not find that user in the server. They may have left.")],
flags: MessageFlags.Ephemeral,
});
}
// Build list of role IDs to assign based on app type
const gCfg = getGuildConfig(guild.id);
const roleIds = [];
if (appType === "staff") {
if (gCfg.staffRoleId) roleIds.push(gCfg.staffRoleId);
if (gCfg.helperRoleId) roleIds.push(gCfg.helperRoleId);
if (gCfg.ticketStaffRoleId) roleIds.push(gCfg.ticketStaffRoleId);

} else if (appType === "pm") {
if (gCfg.pmRoleId) roleIds.push(gCfg.pmRoleId);
if (gCfg.staffRoleId) roleIds.push(gCfg.staffRoleId);
} else {
// Custom app type — use the roleId stored in appTypes config
const customApp = gCfg.appTypes?.find(a => a.name.toLowerCase() === appType.toLowerCase());
if (customApp?.roleId) roleIds.push(customApp.roleId);
}
// Assign roles
const assignedRoles = [];
const failedRoles = [];
for (const roleId of roleIds) {
try {
const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
if (role) {
await member.roles.add(role);
assignedRoles.push(`<@&${roleId}>`);
} else {
failedRoles.push(roleId);
}
} catch (err) {
console.error(` Failed to assign role ${roleId}:`, err);
failedRoles.push(roleId);
}
}
// DM the applicant
try {
await member.user.send({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Application Accepted!")
.setDescription(
`Congratulations! Your **${appType === "staff" ? "Staff" : appType === "pm" ? "Partner Manager" : appType}** ` +
`application has been accepted!\n\nWelcome to the team! `
)
.setTimestamp(),
],
});
} catch {
console.warn(` Could not DM ${member.user.username} about acceptance`);
}
// Disable buttons on the submission message

const disabledRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`accept_app_${userId}_${appType}`)
.setLabel(" Accepted")
.setStyle(ButtonStyle.Success)
.setDisabled(true),
new ButtonBuilder()
.setCustomId(`deny_app_${userId}_${appType}`)
.setLabel(" Deny")
.setStyle(ButtonStyle.Danger)
.setDisabled(true),
);
await interaction.message.edit({ components: [disabledRow] });
const roleText = assignedRoles.length
? `\n**Roles assigned:** ${assignedRoles.join(", ")}`
: "";
const failText = failedRoles.length
? `\n Could not assign roles: ${failedRoles.join(", ")} — check role IDs on Railway.`
: "";
return interaction.editReply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Application Accepted")
.setDescription(
`<@${userId}>'s application has been accepted by <@${interaction.user.id}>.` +
roleText + failText
)
.setTimestamp(),
],
});
}
// ── Handler: application deny ─────────────────────────────────
async function handleAppDeny(interaction, userId, appType) {
// Show modal asking for deny reason
const modal = new ModalBuilder()
.setCustomId(`deny_reason_${userId}_${appType}`)
.setTitle("Deny Application");
const reasonInput = new TextInputBuilder()
.setCustomId("deny_reason")
.setLabel("Reason for denial")
.setStyle(TextInputStyle.Paragraph)

.setPlaceholder("Enter the reason for denying this application...")
.setRequired(true)
.setMaxLength(500);
modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
return interaction.showModal(modal);
}
// ── Handler: process deny reason modal ───────────────────────
async function handleDenyReasonModal(interaction, userId, appType) {
const reason = interaction.fields.getTextInputValue("deny_reason");
// Defer immediately to prevent timeout
await interaction.deferReply({ flags: MessageFlags.Ephemeral });
const appLabel = appType === "staff" ? "Staff" : appType === "pm" ? "Partner Manager" : appType;
// Try to DM the applicant
try {
const user = await client.users.fetch(userId);
await user.send({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Application Denied")
.setDescription(
`Your **${appLabel}** application has been denied.\n\n` +
`**Reason:** ${reason}\n\n` +
`You may re-apply after **14 days**.`
)
.setTimestamp(),
],
});
} catch {
console.warn(` Could not DM user ${userId} about denial`);
}
// Disable buttons on the submission message
const disabledRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`accept_app_${userId}_${appType}`)
.setLabel(" Accept")
.setStyle(ButtonStyle.Success)
.setDisabled(true),
new ButtonBuilder()
.setCustomId(`deny_app_${userId}_${appType}`)
.setLabel(" Denied")

.setStyle(ButtonStyle.Danger)
.setDisabled(true),
);
await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
return interaction.editReply({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Application Denied")
.setDescription(
`<@${userId}>\'s application has been denied by <@${interaction.user.id}>.\n\n` +
`**Reason:** ${reason}`
)
.setTimestamp(),
],
});
}

// ============================================================
// TICKET SYSTEM — Part 2
// ============================================================
// ── Helper: find or create a category by name ────────────────
async function findOrCreateCategory(guild, categoryName) {
// Look for existing category with exact name match
const existing = guild.channels.cache.find(
c => c.type === ChannelType.GuildCategory && c.name === categoryName
);
if (existing) return existing;
// Create it if it doesn't exist
return guild.channels.create({
name: categoryName,
type: ChannelType.GuildCategory,
});
}
// ── Helper: build ticket welcome embed ───────────────────────
function buildTicketWelcomeEmbed(type, user, guild, customMsg = null) {
const descriptions = {
support: "Our staff team will be with you shortly. Please describe your issue in detail.",
giveaway: "Please provide your giveaway claim details below. Staff will assist you shortly.",
partnership: "Thanks for your interest in partnering! Please share your server details below.",

spawner: "Please let us know what spawner transaction you need help with.",
report_member: "Please describe the situation in detail including any evidence you have.",
report_staff: "Please describe the situation in detail including any evidence you have.",
building: "Please describe what you need built and any details about the project.",
mysterybox: "Please describe your mystery box issue. Staff will assist you shortly.",
};
const guildName = guild?.name ?? "this server";
const desc = customMsg ?? descriptions[type] ?? "A staff member will be with you shortly.";
return new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(" Ticket Opened")
.setDescription(
`Welcome to **${guildName}**, <@${user.id}>!
` +
desc +
`
To close this ticket, click the ** Close Ticket** button below.`
)
.setFooter({ text: `Ticket type: ${type} • Created by ${user.username}` })
.setTimestamp();
}
// ── Handler: /ticketpanelsend ────────────────────────────────
async function handleTicketPanelSend(interaction) {
const cfg = getGuildConfig(interaction.guildId);
const guildName = interaction.guild?.name ?? "Support";
const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(` ${guildName}`)
.setDescription("Thanks for reaching out, feel free to make a ticket.\n\nClick a button below to open a ticket in the relevant category.")
.setFooter({ text: "Only open a ticket if you genuinely need help." })
.setTimestamp();
// Use custom ticket types if set, otherwise use defaults
const ticketTypes = cfg.ticketTypes && cfg.ticketTypes.length > 0
? cfg.ticketTypes
: [
{ name: "Support", customId: "ticket_support", style: ButtonStyle.Primary },
{ name: " Giveaway", customId: "ticket_giveaway", style: ButtonStyle.Success },
{ name: "Spawner", customId: "ticket_spawner", style: ButtonStyle.Secondary },
{ name: " Partnership", customId: "ticket_partnership", style: ButtonStyle.Primary },
{ name: " Member Report", customId: "ticket_report_member", style: ButtonStyle.Danger },

{ name: "Staff Report", customId: "ticket_report_staff", style: ButtonStyle.Danger },
{ name: "Building", customId: "ticket_building", style: ButtonStyle.Secondary },
{ name: " Mystery Box", customId: "ticket_mysterybox", style: ButtonStyle.Success },
];
// Split into rows of 4 max
const rows = [];
for (let i = 0; i < Math.min(ticketTypes.length, 20); i += 4) {
const chunk = ticketTypes.slice(i, i + 4);
rows.push(
new ActionRowBuilder().addComponents(
...chunk.map(t =>
new ButtonBuilder()
.setCustomId(t.customId ?? `ticket_custom_${encodeURIComponent(t.name)}`)
.setLabel(t.name.slice(0, 80))
.setStyle(
t.color === "Green" ? ButtonStyle.Success :
t.color === "Red" ? ButtonStyle.Danger :
t.color === "Grey" ? ButtonStyle.Secondary :
t.style ?? ButtonStyle.Primary
)
)
)
);
}
await interaction.reply({ content: " Ticket panel sent!", flags: MessageFlags.Ephemeral });
return interaction.channel.send({ embeds: [embed], components: rows.slice(0, 5) });
}
// ── Handler: create ticket channel ───────────────────────────
async function handleTicketCreate(interaction, type, isCustom = false) {
const guild = interaction.guild;
const user = interaction.user;
const cfg = getGuildConfig(interaction.guildId);
let config;
if (isCustom) {
// Custom type from /setuptickets
const customType = cfg.ticketTypes?.find(t => t.name === type);
if (!customType) return interaction.reply({ embeds: [errorEmbed("Ticket type not found.")], flags: MessageFlags.Ephemeral });
const resolvedPrefix = customType.prefix ?? type.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
config = {
categoryId: customType.categoryId ?? null, // direct category ID from setuptickets
category: customType.name + " Tickets", // fallback name if creating category
prefix: resolvedPrefix,

welcomeMsg: customType.description ?? customType.welcomeMsg ?? null,
pingRoleIds: customType.pingRoleIds ?? [],
};
} else {
// Default ticket types
const typeMap = {
support: { category: TICKET_CATEGORIES.support, prefix: "support" },
giveaway: { category: TICKET_CATEGORIES.giveaway, prefix: "giveaway" },
spawner: { category: TICKET_CATEGORIES.spawner, prefix: "spawner" },
partnership: { category: TICKET_CATEGORIES.partnership, prefix: "partnership" },
report_member: { category: TICKET_CATEGORIES.report, prefix: "member-report" },
report_staff: { category: TICKET_CATEGORIES.report, prefix: "staff-report" },
building: { category: TICKET_CATEGORIES.building, prefix: "building" },
mysterybox: { category: TICKET_CATEGORIES.mysterybox, prefix: "mysterybox" },
};
config = typeMap[type];
if (!config) return interaction.reply({ embeds: [errorEmbed("Unknown ticket type.")], flags: MessageFlags.Ephemeral });
}
// Check if user already has an open ticket of this type
const existingChannel = guild.channels.cache.find(
c => c.name === `${config.prefix}-${user.username.toLowerCase()}` &&
c.type === ChannelType.GuildText
);
if (existingChannel) {
return interaction.reply({
embeds: [errorEmbed(`You already have an open ticket: <#${existingChannel.id}>`)],
flags: MessageFlags.Ephemeral,
});
}
// Find category by ID (from setuptickets) or by name fallback
let category;
try {
if (config.categoryId) {
category = guild.channels.cache.get(config.categoryId)
?? await guild.channels.fetch(config.categoryId).catch(() => null);
if (!category) throw new Error("Category ID not found: " + config.categoryId);
} else {
category = await findOrCreateCategory(guild, config.category);
}
} catch (err) {
console.error(" Failed to find/create category:", err);
return interaction.reply({
embeds: [errorEmbed("Could not find the ticket category. Check the Category ID in `/setuptickets` or ensure the bot has Manage Channels permission.")],
flags: MessageFlags.Ephemeral,

});
}
// Get ticket staff role from per-guild config
const ticketStaffRoleId = cfg.ticketStaffRoleId;
// Build permission overwrites
const permissionOverwrites = [
{
// @everyone cannot see the channel
id: guild.roles.everyone,
deny: [PermissionsBitField.Flags.ViewChannel],
},
{
// The user who opened the ticket can see and send
id: user.id,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.ReadMessageHistory,
PermissionsBitField.Flags.AttachFiles,
],
},
{
// The bot itself can always see and manage
id: guild.members.me.id,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.ManageChannels,
PermissionsBitField.Flags.ReadMessageHistory,
],
},
];
// Add ticket staff role permission if set
if (ticketStaffRoleId) {
permissionOverwrites.push({
id: ticketStaffRoleId,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.ReadMessageHistory,
PermissionsBitField.Flags.ManageMessages,
],
});
}

// Add extra viewer roles (can see ticket but not manage)
if (config.viewerRoleIds?.length) {
config.viewerRoleIds.forEach(roleId => {
if (roleId && roleId !== ticketStaffRoleId) {
permissionOverwrites.push({
id: roleId,
allow: [
PermissionsBitField.Flags.ViewChannel,
PermissionsBitField.Flags.SendMessages,
PermissionsBitField.Flags.ReadMessageHistory,
],
});
}
});
}
// Create the ticket channel
let ticketChannel;
try {
ticketChannel = await guild.channels.create({
name: `${config.prefix}-${user.username.toLowerCase()}`,
type: ChannelType.GuildText,
parent: category.id,
permissionOverwrites,
});
} catch (err) {
console.error(" Failed to create ticket channel:", err);
return interaction.reply({
embeds: [errorEmbed("Could not create the ticket channel. Make sure the bot has Manage Channels permission.")],
flags: MessageFlags.Ephemeral,
});
}
// Build close button
const closeRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`ticket_close_${ticketChannel.id}`)
.setLabel(" Close Ticket")
.setStyle(ButtonStyle.Danger)
);
// Build ping content: user + ticket staff role + any custom ping roles
const pingParts = ["<@" + user.id + ">"];
if (ticketStaffRoleId) pingParts.push("<@&" + ticketStaffRoleId + ">");
if (config.pingRoleIds) config.pingRoleIds.forEach(r => { if (r !== ticketStaffRoleId) pingParts.push("<@&" + r + ">"); });

// Send welcome embed inside the ticket channel
await ticketChannel.send({
content: pingParts.join(" "),
embeds: [buildTicketWelcomeEmbed(type, user, guild, config.welcomeMsg ?? null)],
components: [closeRow],
});
// Confirm to the user
return interaction.reply({
embeds: [
new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Ticket Created")
.setDescription(`Your ticket has been created: <#${ticketChannel.id}>`)
.setTimestamp()
],
flags: MessageFlags.Ephemeral,
});
}
// ── Handler: close ticket modal submission ───────────────────
async function handleTicketClose(interaction, channelId) {
// Show a modal asking for close reason
const modal = new ModalBuilder()
.setCustomId(`ticket_close_reason_${channelId}`)
.setTitle("Close Ticket");
const reasonInput = new TextInputBuilder()
.setCustomId("close_reason")
.setLabel("Reason for closing")
.setStyle(TextInputStyle.Paragraph)
.setPlaceholder("Enter the reason for closing this ticket...")
.setRequired(true)
.setMaxLength(500);
modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
return interaction.showModal(modal);
}
// ── Handler: process ticket close modal ─────────────────────
async function handleTicketCloseModal(interaction, channelId) {
const reason = interaction.fields.getTextInputValue("close_reason");
const channel = interaction.guild.channels.cache.get(channelId);
if (!channel) {
return interaction.reply({
embeds: [errorEmbed("Could not find the ticket channel to close.")],

flags: MessageFlags.Ephemeral,
});
}
// Send closing message in the channel before deleting
await channel.send({
embeds: [
new EmbedBuilder()
.setColor(0xe74c3c)
.setTitle(" Ticket Closed")
.setDescription(
`This ticket has been closed by <@${interaction.user.id}>.\n\n` +
`**Reason:** ${reason}`
)
.setTimestamp()
],
});
await interaction.reply({ content: " Closing ticket...", flags: MessageFlags.Ephemeral });
// Wait 3 seconds so staff can see the closing message, then delete
setTimeout(async () => {
try {
await channel.delete(`Ticket closed by ${interaction.user.username}: ${reason}`);
} catch (err) {
console.error(" Failed to delete ticket channel:", err);
}
}, 3000);
}

// ============================================================
// WELCOME SYSTEM — auto-welcome new members
// ============================================================
client.on("guildMemberAdd", async (member) => {
// Track join in invite tracker
const trackerData = inviteTracker.get(member.guild.id) ?? { joins: [], leaves: [] };
trackerData.joins.push({ userId: member.id, timestamp: Date.now() });
inviteTracker.set(member.guild.id, trackerData);
// Welcome message
const cfg = getGuildConfig(member.guild.id);
if (!cfg.welcomeEnabled) return;
const welcomeChannelId = cfg.welcomeChannelId;
if (!welcomeChannelId) return;

// Fetch from THIS guild only — never cross-guild
const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId)
?? await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
if (!welcomeChannel) {
console.error(" Welcome channel not found in guild " + member.guild.name);
return;
}
const memberCount = member.guild.memberCount;
const guildName = member.guild.name;
const embed = new EmbedBuilder()
.setColor(0x5865f2)
.setTitle(`Welcome to ${guildName}!`)
.setDescription(
`Hey <@${member.id}>, welcome to **${guildName}**!\n\n` +
`You are our **${memberCount}${getOrdinal(memberCount)} member**.\n\n` +
`Make sure to read the rules and enjoy your stay!`
)
.setThumbnail(member.user.displayAvatarURL({ forceStatic: false }) ?? null)
.setFooter({ text: `${guildName} • Member #${memberCount}` })
.setTimestamp();
try {
await welcomeChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
} catch (err) {
console.error(" Failed to send welcome message:", err);
}
});
client.on("guildMemberRemove", async (member) => {
// Track leave in invite tracker
const trackerData = inviteTracker.get(member.guild.id) ?? { joins: [], leaves: [] };
trackerData.leaves.push({ userId: member.id, timestamp: Date.now() });
inviteTracker.set(member.guild.id, trackerData);
});
// ── Helper: ordinal suffix (1st, 2nd, 3rd, 4th...) ──────────
function getOrdinal(n) {
const s = ["th", "st", "nd", "rd"];
const v = n % 100;
return s[(v - 20) % 10] || s[v] || s[0];
}
// ============================================================

// CLIENT READY EVENT
// ============================================================
client.once("ready", async () => {
console.log(` Bot logged in as ${client.user.username}`);
console.log(` Serving ${client.guilds.cache.size} guild(s)`);
try {
await registerCommands();
} catch (err) {
console.error(" Command registration failed on ready:", err);
// Do NOT process.exit here — bot can still function with existing commands
}
});
// ============================================================
// LEADERBOARD HELPERS
// ============================================================
function getPeriodCutoff(period) {
const now = Date.now();
if (period === "week") return now - 7 * 24 * 60 * 60 * 1000;
if (period === "month") return now - 30 * 24 * 60 * 60 * 1000;
return 0; // all time
}
function buildPartnerLeaderboard(guildId, period) {
const cutoff = getPeriodCutoff(period);
const links = (partnerLinks.get(guildId) ?? []).filter(e => e.timestamp >= cutoff);
const labels = { week: "Last 7 Days", month: "Last Month", all: "All Time" };
if (links.length === 0) {
return new EmbedBuilder().setColor(0xe74c3c).setTitle(" Partner Leaderboard")
.setDescription("No partner links have been tracked yet.\nMake sure a partner channel is set with `/setupchannels`.")
.setTimestamp();
}
// Count per user
const counts = {};
for (const e of links) counts[e.userId] = (counts[e.userId] || 0) + 1;
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
const medals = [" "," "," "];
const lines = sorted.slice(0, 15).map(([uid, cnt], i) =>
`${medals[i] ?? `**${i+1}.**`} <@${uid}> — **${cnt}** partner${cnt === 1 ? "" : "s"}`
);
return new EmbedBuilder()

.setColor(0x2ecc71)
.setTitle(" Partner Leaderboard — " + labels[period])
.setDescription(lines.join("\n"))
.setFooter({ text: "Updates every 30 mins • Discord invite links only • Counted as partners" })
.setTimestamp();
}
function buildGiveawayTrackingLeaderboard(guildId, period) {
const cutoff = getPeriodCutoff(period);
const labels = { week: "Last 7 Days", month: "Last Month", all: "All Time" };
const prefix = guildId + ":";
const entries = [];
for (const [key, val] of giveawayHostCounts.entries()) {
if (!key.startsWith(prefix)) continue;
const userId = key.slice(prefix.length);
const timestamps = val.timestamps ?? [];
const count = period === "all" ? (val.count ?? 0) : timestamps.filter(t => t >= cutoff).length;
if (count > 0) entries.push({ userId, count });
}
entries.sort((a, b) => b.count - a.count);
if (entries.length === 0) {
return new EmbedBuilder().setColor(0xe74c3c).setTitle(" Giveaway Tracking")
.setDescription("No giveaways have been hosted yet in this period.")
.setTimestamp();
}
const medals = [" "," "," "];
const lines = entries.slice(0, 15).map(({ userId, count }, i) =>
`${medals[i] ?? `**${i+1}.**`} <@${userId}> — **${count}** giveaway${count === 1 ? "" : "s"}`
);
return new EmbedBuilder()
.setColor(0xf1c40f)
.setTitle(" Giveaway Host Leaderboard — " + labels[period])
.setDescription(lines.join("\n"))
.setFooter({ text: "Updates every 30 mins" })
.setTimestamp();
}
function buildVouchLeaderboard(guildId, period) {
const cutoff = getPeriodCutoff(period);
const labels = { week: "Last 7 Days", month: "Last Month", all: "All Time" };
const sorted = [...vouchStore.entries()]

.map(([userId, vouches]) => {
const filtered = period === "all" ? vouches : vouches.filter(v => v.timestamp >= cutoff);
return { userId, count: filtered.length };
})
.filter(e => e.count > 0)
.sort((a, b) => b.count - a.count);
if (sorted.length === 0) {
return new EmbedBuilder().setColor(0xe74c3c).setTitle(" Vouch Leaderboard")
.setDescription("No vouches recorded in this period.")
.setTimestamp();
}
const medals = [" "," "," "];
const lines = sorted.slice(0, 15).map(({ userId, count }, i) => {
const scams = (scamVouchStore.get(userId) ?? []).length;
const scamStr = scams > 0 ? ` ${scams} scam` : "";
return `${medals[i] ?? `**${i+1}.**`} <@${userId}> — **${count}** vouch${count === 1 ? "" : "es"}${scamStr}`;
});
return new EmbedBuilder()
.setColor(0x2ecc71)
.setTitle(" Vouch Leaderboard — " + labels[period])
.setDescription(lines.join("\n"))
.setFooter({ text: "Updates every 30 mins • Default: All Time" })
.setTimestamp();
}
// ============================================================
// 30-MINUTE AUTO-REFRESH FOR LEADERBOARD MESSAGES
// ============================================================
// Store pinned leaderboard message IDs so they can be edited on refresh
// { guildId -> { partner: {channelId, messageId}, giveaway: {...}, vouch: {...} } }
const liveLeaderboards = new Map();
setInterval(async () => {
for (const [guildId, boards] of liveLeaderboards.entries()) {
for (const [type, info] of Object.entries(boards)) {
try {
const channel = await client.channels.fetch(info.channelId).catch(() => null);
if (!channel) continue;
const msg = await channel.messages.fetch(info.messageId).catch(() => null);
if (!msg) continue;
let embed;
if (type === "partner") embed = buildPartnerLeaderboard(guildId, info.period ?? "all");

if (type === "giveaway") embed = buildGiveawayTrackingLeaderboard(guildId, info.period ?? "all");
if (type === "vouch") embed = buildVouchLeaderboard(guildId, info.period ?? "all");
if (embed) await msg.edit({ embeds: [embed] }).catch(() => {});
} catch { /* ignore refresh errors */ }
}
}
}, 30 * 60 * 1000);
// ============================================================
// GIVEAWAY SOS
// ============================================================
async function handleSplitOrStealStart(interaction) {
const prizeStr = interaction.options.getString("prize");
const durStr = interaction.options.getString("duration");
const numWinners = interaction.options.getInteger("winners") ?? 2;
const claimStr = interaction.options.getString("claimtime") ?? "10m";
const prize = parseNumber(prizeStr);
if (isNaN(prize) || prize <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid prize amount. Use e.g. `10m`, `500k`.")], flags: MessageFlags.Ephemeral });
}
const durationMs = parseDuration(durStr);
if (isNaN(durationMs) || durationMs <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid duration. Use e.g. `1h`, `30m`.")], flags: MessageFlags.Ephemeral });
}
const claimMs = parseDuration(claimStr);
if (isNaN(claimMs) || claimMs <= 0) {
return interaction.reply({ embeds: [errorEmbed("Invalid claim time. Use e.g. `5m`, `24h`.")], flags: MessageFlags.Ephemeral });
}
const endsAt = Date.now() + durationMs;
const data = {
prize,
prizeStr,
numWinners,
claimMs,
isDork: false,
maxPrize: null,
endsAt,
hostId: interaction.user.id,
channelId: interaction.channelId,
guildId: interaction.guildId,
entries: [],

isSplitOrSteal: true,
};
const joinBtn = new ButtonBuilder()
.setCustomId("giveaway_join")
.setLabel("Enter Giveaway")
.setStyle(ButtonStyle.Primary);
const embed = new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(" GIVEAWAY SOS ")
.setDescription(
`**Prize: ${formatNumber(prize)}**\n\n` +
` Ending: <t:${Math.floor(endsAt / 1000)}:R>\n` +
` Host: <@${data.hostId}>\n` +
` Winners: **${numWinners}**\n` +
` Entries: **0**\n\n` +
`After the giveaway ends, winners will be DM'd and asked to **Split** or **Steal** the prize.`
)
.setTimestamp(endsAt);
await interaction.reply({ content: " GiveawaySoS created!", flags: MessageFlags.Ephemeral });
const msg = await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(joinBtn)] });
data.messageId = msg.id;
activeGiveaways.set(msg.id, data);
const hostKey = `${interaction.guildId}:${interaction.user.id}`;
const prev = giveawayHostCounts.get(hostKey) ?? { count: 0, timestamps: [] };
prev.count += 1;
prev.timestamps = [...(prev.timestamps || []), Date.now()];
giveawayHostCounts.set(hostKey, prev);
setTimeout(() => endSplitOrStealGiveaway(msg.id, interaction.channel, data), durationMs);
}
async function endSplitOrStealGiveaway(messageId, channel, data) {
activeGiveaways.delete(messageId);
if (data.entries.length === 0) {
return channel.send({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(" Giveaway Ended").setDescription(`No entries for **${formatNumber(data.prize)}**. No winners.`).setTimestamp()] });
}
const shuffled = [...data.entries].sort(() => Math.random() - 0.5);
const winnerIds = shuffled.slice(0, Math.min(data.numWinners, shuffled.length));
const perPerson = data.prize / winnerIds.length;

// Announce winners in channel
const mentions = winnerIds.map(id => `<@${id}>`).join(", ");
await channel.send({
content: mentions,
embeds: [new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(" GiveawaySoS — Winners Selected!")
.setDescription(
`**${winnerIds.length} winner${winnerIds.length > 1 ? "s" : ""} selected!**\n\n` +
winnerIds.map((id, i) => ` Winner ${i+1}: <@${id}>`).join("\n") + "\n\n" +
`Each winner has been DM'd. They have **${data.claimMs / 60000} minutes** to respond.`
).setTimestamp()],
});
// DM each winner
const responses = new Map(); // userId -> "split" | "steal" | "timeout"
const promises = winnerIds.map(userId => dmSplitOrSteal(userId, data.prize, perPerson, winnerIds.length, data.claimMs, responses));
await Promise.all(promises);
// Calculate result
const stealers = winnerIds.filter(id => responses.get(id) === "steal");
const timeouts = winnerIds.filter(id => responses.get(id) === "timeout");
// Any steal OR timeout = nobody wins
const anyBadActor = stealers.length > 0 || timeouts.length > 0;
let resultDesc = "";
const resultLines = winnerIds.map(id => {
const r = responses.get(id);
if (r === "steal") return `<@${id}> — Stole`;
if (r === "timeout") return `<@${id}> — Did not respond in time`;
return `<@${id}> — Split`;
});
if (!anyBadActor) {
// Everyone split — each person wins their share
resultDesc = ` **Everyone split!** Each winner receives **${formatNumber(perPerson)}**!`;
} else if (stealers.length > 0 && timeouts.length === 0 && stealers.length === winnerIds.length) {
resultDesc = ` **Everyone stole! Nobody wins anything.**`;
} else if (timeouts.length > 0 && stealers.length === 0 && timeouts.length === winnerIds.length) {
resultDesc = ` **Nobody responded in time. Nobody wins.**`;
} else {
// Mix of any steal/timeout — nobody wins
const reasons = [];
if (stealers.length > 0) reasons.push(`${stealers.length} stole`);
if (timeouts.length > 0) reasons.push(`${timeouts.length} didn't respond`);
resultDesc = ` **Nobody wins.** (${reasons.join(", ")})`;

}
await channel.send({
embeds: [new EmbedBuilder()
.setColor(anyBadActor ? 0xe74c3c : 0x2ecc71)
.setTitle(" GiveawaySoS — Final Results")
.setDescription(resultDesc + "\n\n" + resultLines.join("\n"))
.setFooter({ text: `Host: <@${data.hostId}> • Prize: ${formatNumber(data.prize)}` })
.setTimestamp()],
});
}
async function dmSplitOrSteal(userId, totalPrize, perPerson, totalWinners, claimMs, responses) {
try {
const user = await client.users.fetch(userId).catch(() => null);
if (!user) { responses.set(userId, "timeout"); return; }
const splitBtn = new ButtonBuilder().setCustomId(`sos_split_${userId}`).setLabel(" Split").setStyle(ButtonStyle.Success);
const stealBtn = new ButtonBuilder().setCustomId(`sos_steal_${userId}`).setLabel(" Steal").setStyle(ButtonStyle.Danger);
const row = new ActionRowBuilder().addComponents(splitBtn, stealBtn);
const deadlineTs = Math.floor((Date.now() + claimMs) / 1000);
const dm = await user.createDM();
const msg = await dm.send({
embeds: [new EmbedBuilder()
.setColor(0xe67e22)
.setTitle(" You Won a GiveawaySoS!")
.setDescription(
`**Congratulations!** You won a prize of **${formatNumber(totalPrize)}**!\n\n` +
`There are **${totalWinners}** winners. If everyone splits, each person gets **${formatNumber(perPerson)}**.\n\n` +
` **What do you want to do?**\n` +
` **Split** — You get your fair share (${formatNumber(perPerson)})\n` +
` **Steal** — You take everything IF no one else steals\n\n` +
` You have until <t:${deadlineTs}:R> to respond. If you don't respond, you forfeit.`
).setTimestamp()],
components: [row],
});
// Wait for their response
return new Promise(resolve => {
const timeout = setTimeout(async () => {
responses.set(userId, "timeout");
await msg.edit({
embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(" Time's Up").setDescription("You didn't respond in time. Your prize has been forfeited.").setTimestamp()],
components: [],
}).catch(() => {});
splitOrStealSessions.delete(userId);

resolve();
}, claimMs);
splitOrStealSessions.set(userId, {
respond: async (choice) => {
clearTimeout(timeout);
responses.set(userId, choice);
await msg.edit({
embeds: [new EmbedBuilder()
.setColor(choice === "split" ? 0x2ecc71 : 0xe74c3c)
.setTitle(choice === "split" ? " You chose Split!" : " You chose Steal!")
.setDescription("Your choice has been recorded. Check the giveaway channel for the final results!")
.setTimestamp()],
components: [],
}).catch(() => {});
splitOrStealSessions.delete(userId);
resolve();
},
});
});
} catch {
responses.set(userId, "timeout");
}
}
// ============================================================
// UNHANDLED ERRORS — prevent Railway crash on promise rejection
// ============================================================
process.on("unhandledRejection", (err) => {
console.error(" Unhandled promise rejection:", err);
});
process.on("uncaughtException", (err) => {
console.error(" Uncaught exception:", err);
});
// ============================================================
// LOGIN
// ============================================================
if (!process.env.TOKEN) {
console.error(" FATAL: Missing TOKEN environment variable. Bot cannot start.");
process.exit(1);
}
client.login(process.env.TOKEN);