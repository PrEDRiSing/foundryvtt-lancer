import { AppliedDamage } from "../actor/damage-calc";
import { LancerActor, LancerNPC } from "../actor/lancer-actor";
import { DamageHudData } from "../apps/damage";
import { openSlidingHud } from "../apps/slidinghud";
import { DamageType } from "../enums";
import { LancerItem, LancerMECH_WEAPON, LancerNPC_FEATURE, LancerPILOT_WEAPON } from "../item/lancer-item";
import { Damage, DamageData } from "../models/bits/damage";
import { Tag } from "../models/bits/tag";
import { UUIDRef } from "../source-template";
import { LancerToken } from "../token";
import { renderTemplateStep } from "./_render";
import { AttackFlag } from "./attack";
import { Flow, FlowState, Step } from "./flow";
import { LancerFlowState } from "./interfaces";

type DamageFlag = {
  damageResults: LancerFlowState.DamageResult[];
  critDamageResults: LancerFlowState.DamageResult[];
  targetDamageResults: LancerFlowState.DamageTargetResultSerialized[];
  // TODO: AP and paracausal flags
  ap: boolean;
  paracausal: boolean;
  half_damage: boolean;
  targetsApplied: Record<string, boolean>;
};

export function registerDamageSteps(flowSteps: Map<string, Step<any, any> | Flow<any>>) {
  flowSteps.set("initDamageData", initDamageData);
  flowSteps.set("setDamageTags", setDamageTags);
  flowSteps.set("setDamageTargets", setDamageTargets);
  flowSteps.set("showDamageHUD", showDamageHUD);
  flowSteps.set("rollDamages", rollDamages);
  flowSteps.set("applyOverkillHeat", applyOverkillHeat);
  flowSteps.set("printDamageCard", printDamageCard);
}

/**
 * Flow for rolling and applying damage to a token, typically from a weapon attack
 */
export class DamageRollFlow extends Flow<LancerFlowState.DamageRollData> {
  static steps = [
    "initDamageData",
    "setDamageTags", // Move some tags from setAttackTags to here
    "setDamageTargets", // Can we reuse setAttackTargets?
    "showDamageHUD",
    "rollDamages",
    "applyOverkillHeat",
    "printDamageCard",
  ];
  constructor(uuid: UUIDRef | LancerItem | LancerActor, data?: Partial<LancerFlowState.DamageRollData>) {
    const initialData: LancerFlowState.DamageRollData = {
      type: "damage",
      title: data?.title || "Damage Roll",
      configurable: data?.configurable !== undefined ? data.configurable : true,
      add_burn: data?.add_burn !== undefined ? data.add_burn : true,
      invade: data?.invade || false,
      ap: data?.ap || false,
      paracausal: data?.paracausal || false,
      half_damage: data?.half_damage || false,
      overkill: data?.overkill || false,
      reliable: data?.reliable || false,
      hit_results: data?.hit_results || [],
      has_normal_hit: data?.has_normal_hit || false,
      has_crit_hit: data?.has_crit_hit || false,
      damage: data?.damage || [],
      bonus_damage: data?.bonus_damage || [],
      damage_results: [],
      crit_damage_results: [],
      damage_total: 0,
      crit_total: 0,
      targets: [],
    };
    super(uuid, initialData);
  }
}

async function initDamageData(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);

  if (state.item?.is_mech_weapon()) {
    const profile = state.item.system.active_profile;
    // state.data.damage = state.data.damage.length ? state.data.damage : profile.damage;
    // state.data.bonus_damage = state.data.bonus_damage?.length ? state.data.bonus_damage : profile.bonus_damage;

    state.data.damage_hud_data = DamageHudData.fromParams(
      state.item,
      profile.all_tags,
      state.data.title,
      Array.from(game.user!.targets),
      state.data.ap,
      state.data.paracausal,
      state.data.half_damage,
      { damage: state.data.damage, bonusDamage: state.data.bonus_damage }
    );
  } else if (state.item?.is_npc_feature() && state.item.system.type === "Weapon") {
    // const tierIndex = (state.item.system.tier_override || (state.actor as LancerNPC).system.tier) - 1;
    // state.data.damage = state.data.damage.length ? state.data.damage : state.item.system.damage[tierIndex];
    state.data.damage_hud_data = DamageHudData.fromParams(
      state.item,
      state.item.system.tags,
      state.data.title,
      Array.from(game.user!.targets),
      state.data.ap,
      state.data.paracausal,
      state.data.half_damage,
      { damage: state.data.damage, bonusDamage: state.data.bonus_damage }
    );
  } else if (state.item?.is_pilot_weapon()) {
    // state.data.damage = state.data.damage.length ? state.data.damage : state.item.system.damage;
    state.data.damage_hud_data = DamageHudData.fromParams(
      state.item,
      state.item.system.tags,
      state.data.title,
      Array.from(game.user!.targets),
      state.data.ap,
      state.data.paracausal,
      state.data.half_damage,
      { damage: state.data.damage, bonusDamage: state.data.bonus_damage }
    );
  } else if (state.data.damage.length === 0) {
    ui.notifications!.warn(
      state.item ? `Item ${state.item.id} is not a weapon!` : `Damage flow is missing damage to roll!`
    );
    return false;
  }

  // Check whether we have any normal or crit hits
  state.data.has_normal_hit =
    state.data.hit_results.length === 0 || state.data.hit_results.some(hit => hit.hit && !hit.crit);
  state.data.has_crit_hit = state.data.hit_results.length > 0 && state.data.hit_results.some(hit => hit.crit);

  return true;
}

function checkForProfileTags(item: LancerItem, check: (tag: Tag) => boolean) {
  if (!item.is_mech_weapon()) return false;
  return item.system.active_profile.tags.some(check);
}

async function setDamageTags(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  // If the damage roll has no item, it has no tags.
  if (!state.item) return true;
  if (!state.item.is_mech_weapon() && !state.item.is_npc_feature() && !state.item.is_pilot_weapon())
    throw new TypeError(`Item ${state.item.id} is not a weapon!`);
  const weapon = state.item as LancerMECH_WEAPON | LancerNPC_FEATURE | LancerPILOT_WEAPON;
  state.data.ap = weapon.isAP() || checkForProfileTags(weapon, t => t.is_ap);
  state.data.overkill = weapon.isOverkill() || checkForProfileTags(weapon, t => t.is_overkill);
  if (weapon.isReliable()) {
    let reliableTag;
    if (weapon.is_mech_weapon()) {
      reliableTag = weapon.system.active_profile.tags.find(t => t.is_reliable);
    } else {
      reliableTag = weapon.system.tags.find(t => t.is_reliable);
    }
    const reliableVal = parseInt(reliableTag?.val || "0");
    if (reliableTag && !Number.isNaN(reliableVal)) {
      state.data.reliable_val = reliableVal;
      state.data.reliable = true;
    }
  }
  // TODO: build state.data.damage_hud_data
  return true;
}

async function setDamageTargets(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  // TODO: DamageHudData does not facilitate setting targets after instantiation?
  return true;
}

async function showDamageHUD(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  try {
    state.data.damage_hud_data = await openSlidingHud("damage", state.data.damage_hud_data!);
  } catch (_e) {
    // User hit cancel, abort the flow.
    return false;
  }
  return true;
}

export async function rollDamages(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);

  // Evaluate normal damage. Even if every hit was a crit, we'll use this in
  // the next step for crits
  if (state.data.has_normal_hit || state.data.has_crit_hit) {
    for (const x of state.data.damage ?? []) {
      if (!x.val || x.val == "0") continue; // Skip undefined and zero damage
      let damageRoll: Roll | undefined = new Roll(x.val);
      // Add overkill if enabled.
      if (state.data.overkill) {
        damageRoll.terms.forEach(term => {
          if (term instanceof Die) term.modifiers = ["x1", `kh${term.number}`].concat(term.modifiers);
        });
      }

      await damageRoll.evaluate({ async: true });
      // @ts-expect-error DSN options aren't typed
      damageRoll.dice.forEach(d => (d.options.rollOrder = 2));
      const tooltip = await damageRoll.getTooltip();

      state.data.damage_results.push({
        roll: damageRoll,
        tt: tooltip,
        d_type: x.type,
      });
    }

    for (const hitTarget of state.data.hit_results) {
      if (hitTarget.hit && !hitTarget.crit) {
        state.data.targets.push({
          ...hitTarget.token,
          damage: state.data.damage_results.map(dr => ({ type: dr.d_type, amount: dr.roll.total || 0 })),
          hit: hitTarget.hit,
          crit: hitTarget.crit,
          // TODO: target-specific AP and Paracausal from damage HUD
          ap: state.data.ap,
          paracausal: state.data.paracausal,
          half_damage: state.data.half_damage,
        });
      }
    }
  }

  // TODO: should crit damage rolling be a separate step?
  // If there is at least one crit hit, evaluate crit damage
  if (state.data.has_crit_hit) {
    // NPCs do not follow the normal crit rules. They only get bonus damage from Deadly etc...
    if (!state.actor.is_npc()) {
      await Promise.all(
        state.data.damage_results.map(async result => {
          const c_roll = await getCritRoll(result.roll);
          // @ts-expect-error DSN options aren't typed
          c_roll.dice.forEach(d => (d.options.rollOrder = 2));
          const tt = await c_roll.getTooltip();
          state.data!.crit_damage_results.push({
            roll: c_roll,
            tt,
            d_type: result.d_type,
          });
        })
      );
    } else {
      state.data!.crit_damage_results = state.data!.damage_results;
      // TODO: automation for Deadly
      // Find any Deadly features and add a d6 for each
    }

    for (const hitTarget of state.data.hit_results) {
      if (hitTarget.crit) {
        state.data.targets.push({
          ...hitTarget.token,
          damage: state.data.damage_results.map(dr => ({ type: dr.d_type, amount: dr.roll.total || 0 })),
          hit: hitTarget.hit,
          crit: hitTarget.crit,
          // TODO: target-specific AP and Paracausal from damage HUD
          ap: state.data.ap,
          paracausal: state.data.paracausal,
          half_damage: state.data.half_damage,
        });
      }
    }
  }

  // Include reliable data if the attack was made with no targets or at least one target was missed
  if (
    state.data.reliable &&
    state.data.reliable_val &&
    (!state.data.hit_results.length || state.data.hit_results.some(h => !h.hit && !h.crit))
  ) {
    state.data.reliable_results = state.data.reliable_results || [];
    // Find the first non-heat non-burn damage type
    for (const x of state.data.damage ?? []) {
      if (!x.val || x.val == "0") continue; // Skip undefined and zero damage
      if (x.type === DamageType.Burn || x.type === DamageType.Heat) continue; // Skip burn and heat
      let damageRoll: Roll | undefined = new Roll(state.data.reliable_val.toString());

      await damageRoll.evaluate({ async: true });
      const tooltip = await damageRoll.getTooltip();

      state.data.reliable_results.push({
        roll: damageRoll,
        tt: tooltip,
        d_type: x.type,
      });
      state.data.reliable_total = damageRoll.total;
      break;
    }

    for (const hitTarget of state.data.hit_results) {
      if (!hitTarget.hit && !hitTarget.crit) {
        state.data.targets.push({
          ...hitTarget.token,
          damage: state.data.reliable_results.map(dr => ({ type: dr.d_type, amount: dr.roll.total || 0 })),
          hit: hitTarget.hit,
          crit: hitTarget.crit,
          // TODO: target-specific AP and Paracausal from damage HUD
          ap: state.data.ap,
          paracausal: state.data.paracausal,
          half_damage: state.data.half_damage,
        });
      }
    }
  }

  // If there were only crit hits and no normal hits, don't show normal damage in the results
  state.data.damage_results = state.data.has_normal_hit ? state.data.damage_results : [];

  return true;
}

async function applyOverkillHeat(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);

  // Skip this step if the damage roll doesn't have overkill
  if (!state.data.overkill) return true;
  // Calculate overkill heat
  state.data.overkill_heat = 0;
  (state.data.has_crit_hit ? state.data.crit_damage_results : state.data.damage_results).forEach(result => {
    result.roll.terms.forEach(p => {
      if (p instanceof DiceTerm) {
        p.results.forEach(r => {
          if (r.exploded) state.data!.overkill_heat! += 1;
        });
      }
    });
  });
  if (
    (state.actor.is_mech() || state.actor.is_npc() || state.actor.is_deployable()) &&
    state.actor.system.heat.max > 0
  ) {
    await state.actor.update({ "system.heat.value": state.actor.system.heat.value + state.data.overkill_heat });
  } else {
    // TODO: add a damage application row to apply energy damage to the attacker?
  }
  return true;
}

async function printDamageCard(
  state: FlowState<LancerFlowState.DamageRollData>,
  options?: { template?: string }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  const template = options?.template || `systems/${game.system.id}/templates/chat/damage-card.hbs`;
  const damageData: DamageFlag = {
    damageResults: state.data.damage_results,
    critDamageResults: state.data.crit_damage_results,
    targetDamageResults: state.data.targets.map(t => ({
      ...t,
      actor: t.actor ? { ...t.actor.toObject(), uuid: t.actor.uuid } : undefined,
    })),
    // TODO: AP and paracausal flags
    ap: state.data.ap,
    paracausal: state.data.paracausal,
    half_damage: state.data.half_damage,
    targetsApplied: state.data.targets.reduce((acc: Record<string, boolean>, t) => {
      const uuid = t.actor?.uuid || t.token?.actor?.uuid || null;
      if (!uuid) return acc;
      // We need to replace the dots in the UUID, otherwise Foundry will expand it into a nested object
      acc[uuid.replaceAll(".", "_")] = false;
      return acc;
    }, {}),
  };
  const flags = {
    damageData,
  };
  await renderTemplateStep(state.actor, template, state.data, flags);
  return true;
}

/**
 * Given an evaluated roll, create a new roll that doubles the dice and reuses
 * the dice from the original roll.
 * @param normal The orignal Roll
 * @returns An evaluated Roll
 */
export async function getCritRoll(normal: Roll) {
  const t_roll = new Roll(normal.formula);
  await t_roll.evaluate({ async: true });

  const dice_rolls = Array<DiceTerm.Result[]>(normal.terms.length);
  const keep_dice: number[] = Array(normal.terms.length).fill(0);
  normal.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i] = term.results.map(r => {
        return { ...r };
      });
      const kh = parseInt(term.modifiers.find(m => m.startsWith("kh"))?.substr(2) ?? "0");
      keep_dice[i] = kh || term.number;
    }
  });
  t_roll.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i].push(...term.results);
    }
  });

  // Just hold the active results in a sorted array, then mutate them
  const actives: DiceTerm.Result[][] = Array(normal.terms.length).fill([]);
  dice_rolls.forEach((dice, i) => {
    actives[i] = dice.filter(d => d.active).sort((a, b) => a.result - b.result);
  });
  actives.forEach((dice, i) =>
    dice.forEach((d, j) => {
      d.active = j >= keep_dice[i];
      d.discarded = j < keep_dice[i];
    })
  );

  // We can rebuild him. We have the technology. We can make him better than he
  // was. Better, stronger, faster
  const terms = normal.terms.map((t, i) => {
    if (t instanceof Die) {
      return new Die({
        ...t,
        modifiers: (t.modifiers.filter(m => m.startsWith("kh")).length
          ? t.modifiers
          : [...t.modifiers, `kh${t.number}`]) as (keyof Die.Modifiers)[],
        results: dice_rolls[i],
        number: t.number * 2,
      });
    } else {
      return t;
    }
  });

  return Roll.fromTerms(terms);
}

/*********************************************
    ======== Chat button handlers ==========
*********************************************/

/**
 * This function is attached to damage roll buttons in chat. It constructs the initial
 * data for a DamageFlow, then begins the flow.
 * @param event Click event on a button in a chat message
 */
export async function rollDamage(event: JQuery.ClickEvent) {
  const chatMessageElement = event.currentTarget.closest(".chat-message.message");
  if (!chatMessageElement) {
    ui.notifications?.error("Damage roll button not in chat message");
    return;
  }
  const chatMessage = game.messages?.get(chatMessageElement.dataset.messageId);
  // Get attack data from the chat message
  // @ts-expect-error v10 types
  const attackData = chatMessage?.flags.lancer?.attackData as AttackFlag;
  if (!chatMessage || !attackData) {
    ui.notifications?.error("Damage roll button has no attack data available");
    return;
  }

  // Get the attacker and weapon/system from the attack data
  const actor = (await fromUuid(attackData.attackerUuid)) as LancerActor | null;
  if (!actor) {
    ui.notifications?.error("Invalid attacker for damage roll");
    return;
  }
  const item = (await fromUuid(attackData.attackerItemUuid || "")) as LancerItem | null;
  if (item && item.parent !== actor) {
    ui.notifications?.error(`Item ${item.uuid} is not owned by actor ${actor.uuid}!`);
    return;
  }
  const hit_results: LancerFlowState.HitResult[] = [];
  for (const t of attackData.targets) {
    const target = await fromUuid(t.id);
    if (!target || !(target instanceof LancerActor || target instanceof LancerToken)) {
      ui.notifications?.error("Invalid target for damage roll");
      continue;
    }

    // Find the target's image
    let img = "";
    if (target instanceof LancerActor) img = target.img!;
    // @ts-expect-error v10 types
    else if (target instanceof LancerToken) img = target.texture.src;

    // Determine whether lock on was used
    let usedLockOn = false;
    if (t.setConditions) {
      // @ts-expect-error v10 types
      usedLockOn = t.setConditions.lockOn === false ? true : false;
    }

    hit_results.push({
      token: {
        name: target.name!,
        img,
        actor: target instanceof LancerActor ? target : target.actor || undefined,
        token: target instanceof LancerToken ? target : undefined,
      },
      total: t.total,
      usedLockOn,
      hit: t.hit,
      crit: t.crit,
    });
  }

  // Collect damage from the item
  const damage: DamageData[] = [];
  const bonus_damage: DamageData[] = [];
  if (attackData.invade) {
    damage.push({ type: DamageType.Heat, val: "2" });
  }

  // Start a damage flow, prepopulated with the attack data
  const flow = new DamageRollFlow(item ? item.uuid : attackData.attackerUuid, {
    title: `${item?.name || actor.name} DAMAGE`,
    configurable: true,
    invade: attackData.invade,
    hit_results,
    has_normal_hit: hit_results.some(hr => hr.hit && !hr.crit),
    has_crit_hit: hit_results.some(hr => hr.crit),
    damage,
    bonus_damage,
  });
  flow.begin();
}

/**
 * This function is attached to damage application buttons in chat. It performs calls
 * LancerActor.damageCalc to calculate and apply the final damage, and sets a flag
 * on the chat message to indicate the damage for this target has been applied.
 * @param event Click event on a button in a chat message
 */
export async function applyDamage(event: JQuery.ClickEvent) {
  const chatMessageElement = event.currentTarget.closest(".chat-message.message");
  if (!chatMessageElement) {
    ui.notifications?.error("Damage application button not in chat message");
    return;
  }
  const chatMessage = game.messages?.get(chatMessageElement.dataset.messageId);
  // @ts-expect-error v10 types
  const damageData = chatMessage?.flags.lancer?.damageData as DamageFlag;
  if (!chatMessage || !damageData) {
    ui.notifications?.error("Damage application button has no damage data available");
    return;
  }
  const buttonGroup = event.currentTarget.closest(".lancer-damage-button-group");
  if (!buttonGroup) {
    ui.notifications?.error("No target for damage application");
    return;
  }
  const data = buttonGroup.dataset;
  if (!data.target) {
    ui.notifications?.error("No target for damage application");
    return;
  }
  let multiple: number = 1;
  const multipleSelect = buttonGroup.querySelector("select");
  if (multipleSelect) {
    multiple = parseFloat(multipleSelect.value);
    multiple = Number.isNaN(multiple) ? 1 : multiple;
  }
  const addBurn = data.addBurn === "true";
  const isCrit = data.crit === "true";
  const isHit = data.hit === "true";
  // Replace underscores with dots to turn it back into a valid UUID
  const targetFlagKey = data.target.replaceAll(".", "_");
  if (damageData.targetsApplied[targetFlagKey]) {
    ui.notifications?.warn("Damage has already been applied to this target");
    return;
  }
  const target = await fromUuid(data.target);
  let actor: LancerActor | null = null;
  if (target instanceof LancerActor) actor = target;
  else if (target instanceof LancerToken) actor = target.actor;
  if (!actor) {
    ui.notifications?.error("Invalid target for damage application");
    return;
  }

  // Get the targeted damage result, or construct one
  let damage: LancerFlowState.DamageTargetResult;
  // Try to find target-specific damage data first
  const targetDamage = damageData.targetDamageResults.find(
    tdr => tdr.actor?.uuid === data.target || tdr.token?.actor?.uuid === data.target
  );
  if (targetDamage) {
    damage = targetDamage;
  } else if (isCrit) {
    // If we can't find this specific target, check whether it's a crit or regular hit
    damage = {
      name: actor.name!,
      img: actor.img!,
      damage: damageData.critDamageResults.map(dr => ({ type: dr.d_type, amount: dr.roll.total || 0 })),
      hit: true,
      crit: true,
      ap: damageData.ap,
      paracausal: damageData.paracausal,
      half_damage: damageData.half_damage,
    };
  } else {
    damage = {
      name: actor.name!,
      img: actor.img!,
      damage: damageData.damageResults.map(dr => ({ type: dr.d_type, amount: dr.roll.total || 0 })),
      hit: true,
      crit: false,
      ap: damageData.ap,
      paracausal: damageData.paracausal,
      half_damage: damageData.half_damage,
    };
  }
  // TODO: if not crit and not hit, use reliable damage

  // Apply the damage to the target
  await actor.damageCalc(
    new AppliedDamage(damage.damage.map(d => new Damage({ type: d.type, val: d.amount.toString() }))),
    { multiple, addBurn, ap: damage.ap, paracausal: damage.paracausal }
  );

  // Update the flags on the chat message to indicate the damage has been applied
  damageData.targetsApplied[targetFlagKey] = true;
  await chatMessage.setFlag("lancer", "damageData", damageData);
}
