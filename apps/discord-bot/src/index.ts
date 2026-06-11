import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is required");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`DFC Discord Bot ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("order.accept.")) return;

  const orderId = interaction.customId.replace("order.accept.", "");
  await interaction.deferReply({ ephemeral: true });

  try {
    const apiBaseUrl = process.env.API_BASE_URL ?? "http://api-server:4000/api";
    const botToken = process.env.BOT_INTERNAL_TOKEN;

    if (!botToken) throw new Error("BOT_INTERNAL_TOKEN is required");

    const response = await fetch(`${apiBaseUrl}/discord/orders/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-token": botToken
      },
      body: JSON.stringify({
        orderId,
        companionDiscordId: interaction.user.id,
        messageId: interaction.message.id
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text}`);
    }

    await interaction.editReply({ content: "接单成功，订单已分配到你的陪玩账号。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    await interaction.editReply({ content: `接单失败：${message}` });
  }
});

export function buildOrderAcceptButton(orderId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`order.accept.${orderId}`)
      .setLabel("接单")
      .setStyle(ButtonStyle.Primary)
  );
}

void client.login(token);
