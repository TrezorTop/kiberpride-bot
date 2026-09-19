// «Вся история» on the profile — `kp1:hist:<userId>`. A stub until the history screen is built.
import type { ButtonInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { HISTORY_SOON } from '../views/messages.js';

export const historyButton: ComponentRoute<ButtonInteraction> = {
  defer: 'ephemeral',
  async run(interaction) {
    await interaction.editReply({ content: HISTORY_SOON });
  },
};
