const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
try {
await rest.put(
Routes.applicationGuildCommands('1477661953882329179', '1468260183619932173'),
{ body: [] }
);
console.log('✅ Guild commands cleared!');
} catch (err) {
console.error(err);
}
})();
