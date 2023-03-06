// Import TypeScript modules
import { nanoid } from "nanoid";
import type { LancerActor } from "../actor/lancer-actor.js";

/**
 *
 */
// TODO: Indexed types for templates
export async function renderMacroTemplate(actor: LancerActor | undefined, template: string, templateData: any) {
  templateData._uuid = nanoid();

  const html = await renderTemplate(template, templateData);

  // Schlorp up all the rolls into a mega-roll so DSN sees the stuff to throw
  // on screen
  const aggregate: Roll[] = [];
  if (templateData.roll) {
    aggregate.push(templateData.roll);
  }
  if ((templateData.attacks?.length ?? 0) > 0) {
    aggregate.push(...templateData.attacks.map((a: { roll: Roll }) => a.roll));
  }
  if ((templateData.crit_damages?.length ?? 0) > 0) {
    aggregate.push(...templateData.crit_damages.map((d: { roll: Roll }) => d.roll));
  } else if ((templateData.damages?.length ?? 0) > 0) {
    aggregate.push(...templateData.damages.map((d: { roll: Roll }) => d.roll));
  }
  const roll = Roll.fromTerms([PoolTerm.fromRolls(aggregate)]);

  return renderMacroHTML(actor, html, roll);
}

export async function renderMacroHTML(actor: LancerActor | undefined, html: HTMLElement | string, roll?: Roll) {
  const rollMode = game.settings.get("core", "rollMode");
  const whisper_roll =
    rollMode !== CONST.DICE_ROLL_MODES.PUBLIC
      ? ChatMessage.getWhisperRecipients("GM").filter(u => u.active)
      : undefined;
  let chat_data = {
    type: roll ? CONST.CHAT_MESSAGE_TYPES.ROLL : CONST.CHAT_MESSAGE_TYPES.IC,
    roll: roll,
    speaker: {
      actor: actor,
      token: actor?.token,
      alias: !!actor?.token ? actor.token.name : null,
    },
    content: html,
    whisper: roll ? whisper_roll : [],
  };
  if (!roll) delete chat_data.roll;
  // @ts-ignore This is fine
  const cm = await ChatMessage.create(chat_data);
  cm?.render();
}
