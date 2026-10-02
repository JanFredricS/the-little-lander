/**
 * All cutscene scripts (PLAN.md "Story arc"). One per CutsceneId.
 *
 * Writing rules (enforced by test/story.scripts.test.ts):
 *  - each textLines entry is ONE row of the 2-row text box (<= TEXT_BOX_COLS
 *    characters), at most TEXT_BOX_ROWS entries per shot;
 *  - only characters the pixel font has (plain ASCII: ' not ’, ... not …);
 *  - `duration` shots give the reader time: seconds >= typing time + 1 s.
 *
 * Cast: Wren (the player, they/them), Io (engineer), the Commander of the
 * VSS Halcyon, the research team (one voice), the Keeper, a narrator.
 */

import type { CutsceneId, CutsceneScript, CutsceneShot, ShotAdvance, Speaker, StillId } from '../contracts';

const KEY: ShotAdvance = { kind: 'key' };
const secs = (seconds: number): ShotAdvance => ({ kind: 'duration', seconds });

function shot(still: StillId, speaker: Speaker | undefined, advance: ShotAdvance, ...textLines: string[]): CutsceneShot {
  return speaker ? { still, speaker, textLines, advance } : { still, textLines, advance };
}
/** A dialogue shot that waits for key/tap. */
const say = (still: StillId, speaker: Speaker, ...lines: string[]) => shot(still, speaker, KEY, ...lines);
/** Narration that auto-advances after `seconds`. */
const narrate = (still: StillId, seconds: number, ...lines: string[]) => shot(still, 'narrator', secs(seconds), ...lines);

export const CUTSCENES: Readonly<Record<CutsceneId, CutsceneScript>> = {
  briefing: {
    id: 'briefing',
    shots: [
      narrate('asterFromOrbit', 5.5, 'The survey ship VSS Halcyon, three hundred years out from home.', 'Ahead: Aster. A world broken open, still glowing inside.'),
      say('halcyonBriefingDeck', 'commander', "Morning, everyone. You've all seen the pictures. Aster is real.", 'And our ground team went quiet down there nine days ago.'),
      say('commanderPortrait', 'commander', 'Six scientists. Their last signal came from the floating isles.', 'No distress call. Just... silence.'),
      say('wrenPortrait', 'wren', 'So somebody flies down, finds them, and says hello.', "I'm guessing that somebody is me?"),
      say('commanderPortrait', 'commander', "You're the best small-craft pilot we have, Wren.", 'Take the lander, plant nav beacons, bring our people home.'),
      say('wrenPortrait', 'wren', 'Beacons, people, home. I can remember three things.'),
      say('commanderPortrait', 'commander', 'Hangar Four. Your engineer is already aboard.', 'Oh, and the blast doors cycle in ten minutes. Fly fast.'),
    ],
  },

  meetIo: {
    id: 'meetIo',
    shots: [
      narrate('hangarLaunch', 5, 'Clear of the Halcyon, docked to the CSM, falling toward Aster.'),
      say('landerCockpit', 'io', 'Nice flying! Those doors nearly took the paint off.', "Hi. I'm Io. I keep things running, you keep them pointed up."),
      say('wrenPortrait', 'wren', 'Wren. Sorry about the paint.', 'Wait... you were back there the whole time?'),
      say('ioPortrait', 'io', 'Strapped in, holding a wrench, trying very hard not to scream.', "Very professional. You'd have been proud."),
      say('landerCockpit', 'wren', 'Okay, Io. The CSM gets us through the belt, then we drop.', 'Anything I should know about this old stack?'),
      say('ioPortrait', 'io', "The main engine runs hot. Burn off anything that sticks to us.", "And if something purple waves at you, don't wave back."),
      say('landerCockpit', 'wren', "Noted. Then let's go find six scientists."),
    ],
  },

  descentAwe: {
    id: 'descentAwe',
    shots: [
      shot('csmCockpitRough', 'io', secs(3), 'Hull temperature is climbing! Is it meant to shake like this?!'),
      say('csmCockpitRough', 'wren', 'Nothing about this is normal. Hold on to something!'),
      narrate('csmCockpitRough', 3, 'Then, all at once, the rattling stops.'),
      shot('floatingIslandsVista', undefined, secs(3.5)),
      say('floatingIslandsVista', 'io', 'Oh. Oh, wow.', 'Wren... the ground is floating.'),
      say('floatingIslandsVista', 'wren', 'Islands in the sky. Waterfalls pouring into nothing.', 'And something very big is swimming through the clouds.'),
      say('ioPortrait', 'io', 'Sky-whales? Please be friendly sky-whales.'),
      say('wrenPortrait', 'wren', 'The outpost signal is past the isles.', "Let's take the scenic route."),
    ],
  },

  csmSeized: {
    id: 'csmSeized',
    shots: [
      shot('dragonBirdAttack', 'io', secs(2.5), 'Wren! Something huge, right above us!'),
      narrate('dragonBirdAttack', 2.5, 'Talons close around the service module.'),
      say('dragonBirdAttack', 'wren', "It's got the CSM! Io, emergency detach, now!"),
      say('landerCockpit', 'io', "Clamps blown! We're loose. It's just us and the lander now.", 'Go, go, go!'),
      say('wrenPortrait', 'wren', 'No going back up that way.', 'Beacons first. Then the outpost.'),
    ],
  },

  emptyOutpost: {
    id: 'emptyOutpost',
    shots: [
      narrate('emptyOutpost', 4.5, 'The science outpost. Lights on. Doors open. Nobody home.'),
      say('emptyOutpost', 'io', 'Mugs still on the table. Somebody left in a hurry.'),
      say('wrenPortrait', 'wren', 'No damage, though. No sign of a fight.', "It's like they just... went somewhere."),
      say('ioPortrait', 'io', "Their logs mention a shaft into the island. 'The Throat.'", "Last entry: 'It goes all the way down. We have to see.'"),
      say('wrenPortrait', 'wren', 'Of course it does. Scientists.', 'Okay. Down we go.'),
    ],
  },

  podTransfer: {
    id: 'podTransfer',
    shots: [
      narrate('caveMouthPodTransfer', 4, 'Deep in the Throat, the shaft pinches to a crack.'),
      say('landerCockpit', 'io', "That's it. The lander's legs won't fit through there."),
      say('wrenPortrait', 'wren', 'The ascent pod will. And it has the harpoon rig.'),
      say('ioPortrait', 'io', "Swinging through a cave on a rope. That's your plan.", "...Honestly? I love it. I'll keep the lander warm."),
      say('caveMouthPodTransfer', 'wren', "Keep the radio on. I'll be back with company."),
      narrate('caveMouthPodTransfer', 3, 'The pod drops free into the dark.'),
    ],
  },

  teamFound: {
    id: 'teamFound',
    shots: [
      narrate('researchTeamFound', 4.5, 'A vault of light beneath the crust. Six figures, waving.'),
      say('researchTeamFound', 'team', 'Hello! You found us! Sorry about the radio silence.', "Signals don't get through all this rock."),
      say('wrenPortrait', 'wren', "Everyone's okay? The whole ship thinks you're lost."),
      say('researchTeamFound', 'team', "Lost? We're thrilled! Look up, pilot. That's a sun.", 'An artificial sun, built long before anyone got here.'),
      say('researchTeamFound', 'team', "It's failing. That's why Aster cracked apart.", 'The orbs around it might tell us how to fix it.'),
      say('ioPortrait', 'io', "Io here, over the relay. Did they just say 'fix a sun'?"),
      say('wrenPortrait', 'wren', 'They did. Collect orbs, fix a sun, go home.', 'Beacons, people, home. The list keeps growing.'),
    ],
  },

  keeperWakes: {
    id: 'keeperWakes',
    shots: [
      narrate('hollowSunKeeper', 4, 'The orbs flare as one. Below the sun, something stirs.'),
      say('hollowSunKeeper', 'keeper', '...INTRUDERS. THE LIGHT IS KEPT.', 'THE LIGHT IS MINE.'),
      say('researchTeamFound', 'team', "That's the keeper! It's guarded the sun for ages.", "Alone. For a very, very long time."),
      say('wrenPortrait', 'wren', 'Can we talk it down?'),
      shot('hollowSunKeeper', 'keeper', secs(2.5), '...KEPT. KEPT. KEPT.'),
      say('wrenPortrait', 'wren', "Right. Not a talker. Io, how's my fuel?"),
      say('ioPortrait', 'io', 'Enough to be brave. Not enough to be silly.', "Burn the tendrils, drop rocks on it. You've got this."),
    ],
  },

  keeperFalls: {
    id: 'keeperFalls',
    shots: [
      narrate('keeperDefeated', 4, 'The keeper sinks, its great eye dimming at last.'),
      say('keeperDefeated', 'keeper', '...THE LIGHT...', '...IS YOURS... TO KEEP...'),
      say('keeperDefeated', 'team', "The sun's steadying! But the hollow was built around it...", "...and without the keeper, it's all coming loose!"),
      narrate('collapseEscape', 3, 'The ceiling cracks. Stone begins to fall like rain.'),
      say('ioPortrait', 'io', "Wren, I'm bringing the lander down to you.", 'Everyone pile in! Mind the wrench!'),
      say('wrenPortrait', 'wren', 'Six scientists, one engineer, one very small lander.', "Hold on tight. We're going up. Fast."),
    ],
  },

  finale: {
    id: 'finale',
    shots: [
      narrate('collapseEscape', 3, 'Through the last gap, into open sky...'),
      narrate('reunionAboveClouds', 4, '...and above the clouds, sunlight. Real sunlight.'),
      say('reunionAboveClouds', 'io', 'We made it. We actually made it!', "Wren, I think I'm going to cry on the controls."),
      say('reunionAboveClouds', 'team', 'Thank you, pilot. You flew us out of a falling world.'),
      say('commanderPortrait', 'commander', 'Halcyon to lander. We see you, Wren. Welcome home.', "Hangar Four is open. We'll go slow on the doors this time."),
      narrate('beaconRoadDawn', 4.5, "Below, Aster's sun burns steady for the first time in ages."),
      say('beaconRoadDawn', 'narrator', "And one by one, Wren's beacons light up across the isles:", 'a safe road down, for everyone who comes next.'),
      say('wrenPortrait', 'wren', 'Beacons, people, home. All three.', "...So. What's the next job?"),
      // end credits (S8): the main story ends here; the epilogue lines lead into the post-final Map 9 (round 15)
      narrate('asterFromOrbit', 4, 'THE LITTLE LANDER', 'Thank you for flying.'),
      narrate('floatingIslandsVista', 5, 'Every sprite, tile, still and sound was made in code:', 'TypeScript, PixiJS, Box2D and a lot of seeded noise.'),
      say('beaconRoadDawn', 'narrator', 'THE END', 'Every map stays open in level select. Fly them again!'),
      // round 15 (audit L2): Continue goes on to the post-final Map 9 (Spring Isles): set it up
      say('floatingIslandsVista', 'narrator', 'EPILOGUE. Above the isles, the lift-off', "burned the lander's thrusters out..."),
      say('wrenPortrait', 'wren', 'No engines. But the spring legs still work.', "Fine. I'll hop the rest of the way up."),
    ],
  },
};

/** Every cutscene id, in story order. */
export const CUTSCENE_IDS = Object.keys(CUTSCENES) as CutsceneId[];

export function isCutsceneId(v: string): v is CutsceneId {
  return Object.prototype.hasOwnProperty.call(CUTSCENES, v);
}

export function getCutscene(id: CutsceneId): CutsceneScript {
  return CUTSCENES[id];
}
