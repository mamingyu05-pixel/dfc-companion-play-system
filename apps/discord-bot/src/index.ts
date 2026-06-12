import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials
} from "discord.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is required");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Maycat Discord Bot ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("order.accept.")) {
    await handleOrderAccept(interaction, interaction.customId.replace("order.accept.", ""));
    return;
  }

  if (interaction.customId.startsWith("order-draft.apply.")) {
    await handleOrderDraftApply(interaction, interaction.customId.replace("order-draft.apply.", ""));
  }
});

client.on(Events.MessageCreate, async (message) => {
  await handleSupportMessage(message);
});

async function handleOrderAccept(interaction: ButtonInteraction, orderId: string) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await callApi("/discord/orders/accept", {
      orderId,
      companionDiscordId: interaction.user.id,
      messageId: interaction.message.id
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);

    await interaction.editReply({ content: "接单成功，订单已经分配到你的陪玩账号。" });
  } catch (error) {
    await interaction.editReply({ content: `接单失败：${errorMessage(error)}` });
  }
}

async function handleOrderDraftApply(interaction: ButtonInteraction, draftId: string) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await callApi("/discord/order-drafts/apply", {
      draftId,
      companionDiscordId: interaction.user.id,
      messageId: interaction.message.id
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);

    const data = (await response.json().catch(() => ({}))) as { companionName?: string };
    await interaction.editReply({ content: `报名成功，${data.companionName ?? "你的陪玩账号"} 已进入候选列表。` });
  } catch (error) {
    await interaction.editReply({ content: `报名失败：${errorMessage(error)}` });
  }
}

async function handleSupportMessage(message: Message) {
  if (message.author.bot) return;

  const isDirect = !message.inGuild();
  const supportChannelId = process.env.DISCORD_SUPPORT_CHANNEL_ID;
  const mentionedBot = client.user ? message.mentions.has(client.user) : false;
  const isSupportChannel = Boolean(supportChannelId && message.channelId === supportChannelId);

  if (!isDirect && !isSupportChannel && !mentionedBot) return;
  if (!message.content.trim()) return;

  try {
    const response = await callApi("/discord/support/messages", {
      discordUserId: message.author.id,
      displayName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
      messageId: message.id,
      content: stripBotMention(message.content),
      isDirect
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);

    const data = (await response.json()) as { reply?: string };
    if (data.reply) await message.reply({ content: data.reply.slice(0, 1900) });
  } catch (error) {
    await message.reply({ content: `客服助手暂时不可用，请人工客服处理。原因：${errorMessage(error).slice(0, 500)}` }).catch(() => undefined);
  }
}

function stripBotMention(content: string) {
  return content.replace(/<@!?\d+>/g, "").trim();
}

async function callApi(path: string, body: unknown) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://api-server:4000/api";
  const botToken = process.env.BOT_INTERNAL_TOKEN;
  if (!botToken) throw new Error("BOT_INTERNAL_TOKEN is required");

  return fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-token": botToken
    },
    body: JSON.stringify(body)
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function buildOrderAcceptButton(orderId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`order.accept.${orderId}`).setLabel("接单").setStyle(ButtonStyle.Primary)
  );
}

export function buildOrderDraftApplyButton(draftId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`order-draft.apply.${draftId}`).setLabel("我要报名").setStyle(ButtonStyle.Primary)
  );
}

void client.login(token);
