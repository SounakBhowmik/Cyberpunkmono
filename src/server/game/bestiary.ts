// The monsters that haunt corporate nets, and the programs runners fight them with.

export interface MonsterSpec {
  id: string;
  name: string;
  hp: number;
  ac: number;
  attack: number;
  /** Trace damage as [count, sides, plus]. */
  damage: [number, number, number];
  intro: string;
}

export const MONSTERS: MonsterSpec[] = [
  { id: 'hound', name: 'Black ICE Hound', hp: 14, ac: 12, attack: 3, damage: [1, 8, 2], intro: 'Something with too many teeth uncurls from the packet stream and catches your scent.' },
  { id: 'ooze', name: 'Tar-Pit Ooze', hp: 18, ac: 9, attack: 2, damage: [1, 6, 2], intro: 'The floor of the node goes soft. A slow black mass of corrupted cache rises to swallow you.' },
  { id: 'sentinel', name: 'Sentinel Daemon', hp: 12, ac: 14, attack: 4, damage: [1, 10, 0], intro: 'A faceless knight of white light steps out of the firewall and raises a blade made of audit logs.' },
  { id: 'kraken', name: 'Glitch Kraken', hp: 20, ac: 11, attack: 3, damage: [2, 4, 1], intro: 'Tentacles of broken pixels burst through the walls. The node starts tearing at the seams.' },
  { id: 'mimic', name: 'Mimic Archive', hp: 15, ac: 13, attack: 3, damage: [1, 8, 1], intro: 'The file you were about to open grows a mouth. It was never a file.' },
];

export type ProgramId = 'ghost' | 'babel' | 'icepick' | 'nova' | 'mend';

export interface ProgramSpec {
  id: ProgramId;
  file: string;
  charges: number;
  combatOnly?: boolean;
  noCombat?: boolean;
  blurb: string;
}

export const PROGRAMS: Record<ProgramId, ProgramSpec> = {
  ghost: { id: 'ghost', file: 'ghost.exe', charges: 2, blurb: 'cloaks the runner from the ICE patrol for 3 moves. in combat: slip away from the fight.' },
  babel: { id: 'babel', file: 'babel.dll', charges: 1, noCombat: true, blurb: "translates the wyrm's code-speech: reveals its weakness and which intel you haven't used yet." },
  icepick: { id: 'icepick', file: 'icepick.exe', charges: 1, noCombat: true, blurb: 'shatters one locked node next to the runner. no port, no roll. (useless on the vault)' },
  nova: { id: 'nova', file: 'nova.exe', charges: 1, combatOnly: true, blurb: 'a burst of white noise: 3d6 damage to the ICE you are fighting. never misses.' },
  mend: { id: 'mend', file: 'mend.sys', charges: 1, blurb: 'rewrites your access logs: scrubs 12% trace.' },
};

export const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];

export function programByName(name: string): ProgramSpec | undefined {
  const n = name.toLowerCase().replace(/\.(exe|dll|sys)$/, '');
  return PROGRAMS[n as ProgramId];
}
