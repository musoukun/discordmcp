import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, GatewayIntentBits, TextChannel, Message } from "discord.js";
import { z } from "zod";

// Load environment variables
dotenv.config();

// Discord client setup
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

// Helper function to find a guild by name or ID
async function findGuild(guildIdentifier?: string) {
	// If no guild specified, check configuration
	if (!guildIdentifier) {
		// If bot is only in one guild, use that
		if (client.guilds.cache.size === 1) {
			return client.guilds.cache.first()!;
		}
		// Return null to indicate server name is required
		return null;
	}

	// Try to fetch by ID first
	try {
		const guild = await client.guilds.fetch(guildIdentifier);
		if (guild) return guild;
	} catch {
		// If ID fetch fails, search by name
		const guilds = client.guilds.cache.filter(
			(g) => g.name.toLowerCase() === guildIdentifier.toLowerCase()
		);

		if (guilds.size === 0) {
			return null; // Not found
		}
		if (guilds.size === 1) {
			return guilds.first()!;
		}
		// Multiple guilds with same name, return the first one
		return guilds.first()!;
	}
	return null;
}

// Helper function to find a channel by name or ID within a specific guild
async function findChannel(
	channelIdentifier: string,
	guildIdentifier?: string
): Promise<TextChannel | null> {
	const guild = await findGuild(guildIdentifier);

	// If no guild found and guildIdentifier was provided, return null
	if (!guild) {
		return null;
	}

	// First try to fetch by ID
	try {
		const channel = await client.channels.fetch(channelIdentifier);
		if (
			channel instanceof TextChannel &&
			(!guild || channel.guild.id === guild.id)
		) {
			return channel;
		}
	} catch {
		// If fetching by ID fails, search by name in the specified guild
		const channels = guild.channels.cache.filter(
			(channel): channel is TextChannel =>
				channel instanceof TextChannel &&
				(channel.name.toLowerCase() ===
					channelIdentifier.toLowerCase() ||
					channel.name.toLowerCase() ===
						channelIdentifier.toLowerCase().replace("#", ""))
		);

		if (channels.size === 0) {
			return null;
		}
		return channels.first()!;
	}
	return null;
}

// Find the last non-bot user message in the channel
async function findLastUserMessage(
	channel: TextChannel,
	botId: string,
	contextSize: number = 25
): Promise<{
	lastUserMessage: Message | null;
	conversationContext: Message[];
}> {
	// Get latest messages to analyze conversation context
	const messages = await channel.messages.fetch({ limit: contextSize });
	const messageArray = Array.from(messages.values());

	// Sort messages chronologically (oldest first)
	const sortedMessages = messageArray.sort(
		(a, b) => a.createdTimestamp - b.createdTimestamp
	);

	// Find the last message not sent by a bot
	let lastUserMessage: Message | null = null;

	for (let i = sortedMessages.length - 1; i >= 0; i--) {
		const msg = sortedMessages[i];
		if (!msg.author.bot && msg.author.id !== botId) {
			lastUserMessage = msg;
			break;
		}
	}

	return {
		lastUserMessage,
		conversationContext: sortedMessages,
	};
}

// Format conversation for context understanding
function formatConversation(messages: Message[]): string {
	return messages
		.map((msg) => {
			const authorType = msg.author.bot ? "BOT" : "USER";
			return `[${authorType}:${msg.author.username}] ${msg.content}`;
		})
		.join("\n");
}

// Updated validation schemas
const SendMessageSchema = z.object({
	server: z
		.string()
		.optional()
		.describe("Server name or ID (optional if bot is only in one server)"),
	channel: z.string().describe('Channel name (e.g., "general") or ID'),
	message: z.string().describe("Message content to send"),
});

const ReadMessagesSchema = z.object({
	server: z
		.string()
		.optional()
		.describe("Server name or ID (optional if bot is only in one server)"),
	channel: z.string().describe('Channel name (e.g., "general") or ID'),
	limit: z
		.number()
		.min(1)
		.max(100)
		.default(50)
		.describe("Number of messages to fetch (max 100)"),
});

// New schema for reply-to-conversation
const ReplyToConversationSchema = z.object({
	server: z
		.string()
		.optional()
		.describe("Server name or ID (optional if bot is only in one server)"),
	channel: z.string().describe('Channel name (e.g., "general") or ID'),
	message: z.string().describe("Reply message content"),
	contextSize: z
		.number()
		.min(1)
		.max(50)
		.default(25)
		.describe("Number of messages to analyze for context (max 50)"),
});

// Create server instance
const server = new Server(
	{
		name: "discord",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	}
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "send-message",
				description: "Send a message to a Discord channel",
				inputSchema: {
					type: "object",
					properties: {
						server: {
							type: "string",
							description:
								"Server name or ID (optional if bot is only in one server)",
						},
						channel: {
							type: "string",
							description: 'Channel name (e.g., "general") or ID',
						},
						message: {
							type: "string",
							description: "Message content to send",
						},
					},
					required: ["channel", "message"],
				},
			},
			{
				name: "read-messages",
				description: "Read recent messages from a Discord channel",
				inputSchema: {
					type: "object",
					properties: {
						server: {
							type: "string",
							description:
								"Server name or ID (optional if bot is only in one server)",
						},
						channel: {
							type: "string",
							description: 'Channel name (e.g., "general") or ID',
						},
						limit: {
							type: "number",
							description:
								"Number of messages to fetch (max 100)",
							default: 50,
						},
					},
					required: ["channel"],
				},
			},
			{
				name: "reply-to-conversation",
				description:
					"Reply to the last non-bot user in the conversation",
				inputSchema: {
					type: "object",
					properties: {
						server: {
							type: "string",
							description:
								"Server name or ID (optional if bot is only in one server)",
						},
						channel: {
							type: "string",
							description: 'Channel name (e.g., "general") or ID',
						},
						message: {
							type: "string",
							description: "Reply message content",
						},
						contextSize: {
							type: "number",
							description:
								"Number of messages to analyze for context (max 50)",
							default: 25,
						},
					},
					required: ["channel", "message"],
				},
			},
		],
	};
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case "send-message": {
				const {
					server: serverIdentifier,
					channel: channelIdentifier,
					message,
				} = SendMessageSchema.parse(args);

				// Find guild and channel
				const channel = await findChannel(
					channelIdentifier,
					serverIdentifier
				);

				// Handle cases where guild/channel not found
				if (!channel) {
					// Construct helpful error message
					let errorMsg = "Could not send message: ";

					if (!serverIdentifier && client.guilds.cache.size > 1) {
						const guildList = Array.from(
							client.guilds.cache.values()
						)
							.map((g) => `"${g.name}" (${g.id})`)
							.join(", ");
						errorMsg += `Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`;
					} else if (serverIdentifier) {
						const guild = await findGuild(serverIdentifier);
						if (!guild) {
							const availableGuilds = Array.from(
								client.guilds.cache.values()
							)
								.map((g) => `"${g.name}" (${g.id})`)
								.join(", ");
							errorMsg += `Server "${serverIdentifier}" not found. Available servers: ${availableGuilds}`;
						} else {
							const availableChannels = guild.channels.cache
								.filter(
									(c): c is TextChannel =>
										c instanceof TextChannel
								)
								.map((c) => `"#${c.name}" (${c.id})`)
								.join(", ");
							errorMsg += `Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`;
						}
					} else {
						errorMsg += `Channel "${channelIdentifier}" not found.`;
					}

					return {
						content: [
							{
								type: "text",
								text: errorMsg,
							},
						],
					};
				}

				const sent = await channel.send(message);
				return {
					content: [
						{
							type: "text",
							text: `Message sent successfully to #${channel.name} in ${channel.guild.name}. Message ID: ${sent.id}`,
						},
					],
				};
			}

			case "read-messages": {
				const {
					server: serverIdentifier,
					channel: channelIdentifier,
					limit,
				} = ReadMessagesSchema.parse(args);

				// Find guild and channel
				const channel = await findChannel(
					channelIdentifier,
					serverIdentifier
				);

				// Handle cases where guild/channel not found
				if (!channel) {
					// Construct helpful error message
					let errorMsg = "Could not read messages: ";

					if (!serverIdentifier && client.guilds.cache.size > 1) {
						const guildList = Array.from(
							client.guilds.cache.values()
						)
							.map((g) => `"${g.name}" (${g.id})`)
							.join(", ");
						errorMsg += `Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`;
					} else if (serverIdentifier) {
						const guild = await findGuild(serverIdentifier);
						if (!guild) {
							const availableGuilds = Array.from(
								client.guilds.cache.values()
							)
								.map((g) => `"${g.name}" (${g.id})`)
								.join(", ");
							errorMsg += `Server "${serverIdentifier}" not found. Available servers: ${availableGuilds}`;
						} else {
							const availableChannels = guild.channels.cache
								.filter(
									(c): c is TextChannel =>
										c instanceof TextChannel
								)
								.map((c) => `"#${c.name}" (${c.id})`)
								.join(", ");
							errorMsg += `Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`;
						}
					} else {
						errorMsg += `Channel "${channelIdentifier}" not found.`;
					}

					return {
						content: [
							{
								type: "text",
								text: errorMsg,
							},
						],
					};
				}

				const messages = await channel.messages.fetch({ limit });
				const formattedMessages = Array.from(messages.values()).map(
					(msg) => ({
						channel: `#${channel.name}`,
						server: channel.guild.name,
						author: msg.author.tag,
						content: msg.content,
						timestamp: msg.createdAt.toISOString(),
					})
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(formattedMessages, null, 2),
						},
					],
				};
			}

			case "reply-to-conversation": {
				const {
					server: serverIdentifier,
					channel: channelIdentifier,
					message,
					contextSize = 25,
				} = ReplyToConversationSchema.parse(args);

				// Find guild and channel
				const channel = await findChannel(
					channelIdentifier,
					serverIdentifier
				);

				// Handle cases where guild/channel not found
				if (!channel) {
					// Construct helpful error message
					let errorMsg = "Could not reply to conversation: ";

					if (!serverIdentifier && client.guilds.cache.size > 1) {
						const guildList = Array.from(
							client.guilds.cache.values()
						)
							.map((g) => `"${g.name}" (${g.id})`)
							.join(", ");
						errorMsg += `Bot is in multiple servers. Please specify server name or ID. Available servers: ${guildList}`;
					} else if (serverIdentifier) {
						const guild = await findGuild(serverIdentifier);
						if (!guild) {
							const availableGuilds = Array.from(
								client.guilds.cache.values()
							)
								.map((g) => `"${g.name}" (${g.id})`)
								.join(", ");
							errorMsg += `Server "${serverIdentifier}" not found. Available servers: ${availableGuilds}`;
						} else {
							const availableChannels = guild.channels.cache
								.filter(
									(c): c is TextChannel =>
										c instanceof TextChannel
								)
								.map((c) => `"#${c.name}" (${c.id})`)
								.join(", ");
							errorMsg += `Channel "${channelIdentifier}" not found in server "${guild.name}". Available channels: ${availableChannels}`;
						}
					} else {
						errorMsg += `Channel "${channelIdentifier}" not found.`;
					}

					return {
						content: [
							{
								type: "text",
								text: errorMsg,
							},
						],
					};
				}

				// Find the last non-bot user message and get conversation context
				const { lastUserMessage, conversationContext } =
					await findLastUserMessage(
						channel,
						client.user!.id,
						contextSize
					);

				if (!lastUserMessage) {
					return {
						content: [
							{
								type: "text",
								text: `No non-bot user messages found in the last ${contextSize} messages in #${channel.name}.`,
							},
						],
					};
				}

				// Format conversation for context understanding (for logging/debugging)
				const conversationText =
					formatConversation(conversationContext);

				// Reply to the last user message
				const sent = await lastUserMessage.reply(message);

				return {
					content: [
						{
							type: "text",
							text: `Replied to ${lastUserMessage.author.username} in #${channel.name}. Message ID: ${sent.id}

Conversation Context:
${conversationText}`,
						},
					],
				};
			}

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw new Error(
				`Invalid arguments: ${error.errors
					.map((e) => `${e.path.join(".")}: ${e.message}`)
					.join(", ")}`
			);
		}
		throw error;
	}
});

// Discord client login and error handling
client.once("ready", () => {
	console.error("Discord bot is ready!");
});

// Start the server
async function main() {
	// Check for Discord token
	const token = process.env.DISCORD_TOKEN;
	if (!token) {
		throw new Error("DISCORD_TOKEN environment variable is not set");
	}

	try {
		// Login to Discord
		await client.login(token);

		// Start MCP server
		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error("Discord MCP Server running on stdio");
	} catch (error) {
		console.error("Fatal error in main():", error);
		process.exit(1);
	}
}

main();
