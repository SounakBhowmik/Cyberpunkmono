import { Rng } from './rng.js';

export type IntelKind = 'fragment' | 'personnel' | 'comms';

export interface FileEntry {
  name: string;
  body: string;
  intel?: IntelKind;
}

export interface NetNode {
  id: string;
  label: string;
  links: string[];
  locked: boolean;
  /** Port the operator's schematic lists for cracking a locked node. */
  port: number;
  security: 1 | 2 | 3;
  files: FileEntry[];
}

export interface Intel {
  admin: string;
  adminLast: string;
  ticket: string;
  pet: string;
}

export interface World {
  seed: number;
  corp: string;
  wardenName: string;
  nodes: Map<string, NetNode>;
  /** Middle-layer node ids, in generation order (excludes gateway and vault). */
  middle: string[];
  /** The node adjacent to the vault, where the Warden can be reached. */
  gateId: string;
  passcode: string;
  intel: Intel;
}

export const GATEWAY = 'gateway';
export const VAULT = 'vault';

const CORPS = ['Arasaka-Vey', 'Kiroshi Dynamics', 'Militech Halcyon', 'Zetatech Lumen', 'Biotechnica Rho', 'Petrochem Atlas'];
const WARDENS = ['CERBERUS-7', 'WARDEN//NIX', 'MOTHER-OF-LOCKS', 'BASTION.EXE', 'GATEKEEPER-9'];
const FIRST = ['Mira', 'Tomasz', 'Akira', 'Delphine', 'Okonkwo', 'Rhea', 'Viktor', 'Priya', 'Jun', 'Ines'];
const LAST = ['Voss', 'Halloran', 'Nakamura', 'Ferreira', 'Adeyemi', 'Lindqvist', 'Moreau', 'Kapoor', 'Takeda', 'Okafor'];
const PETS = ['Biscuit', 'Nebula', 'Pixel', 'Mochi', 'Turbo', 'Gizmo', 'Sardine', 'Kernel'];

const NODE_POOL: [string, string][] = [
  ['mail', 'mail relay, 3 sessions idle'],
  ['hr', 'human resources database'],
  ['devops', 'build farm, fans screaming'],
  ['backup', 'cold storage array'],
  ['cctv', 'camera grid, 212 feeds'],
  ['payroll', 'payroll ledger'],
  ['research', 'R&D sandbox'],
  ['kiosk', 'lobby kiosk, sticky with soda'],
  ['printers', 'print spooler, jammed since 2071'],
  ['canteen', 'canteen ordering system'],
];

const FLAVOR: ((corp: string) => FileEntry)[] = [
  (corp) => ({ name: 'memo_q3.txt', body: `${corp} reminds all staff: smiling is a KPI. Frowning will be deducted from wellness credits.` }),
  () => ({ name: 'todo.txt', body: '- rotate keys (later)\n- ask legal if the clone thing is "technically" murder\n- buy synth-coffee' }),
  () => ({ name: 'lunch_order.csv', body: 'name,order\nwatanabe,krill noodles\nfinch,krill noodles\nzero,"nothing, I photosynthesize now"' }),
  () => ({ name: 'error.log', body: '[WARN] coolant pump 4 reports feelings\n[WARN] coolant pump 4 reports feelings\n[ERR ] coolant pump 4 has unionized' }),
  (corp) => ({ name: 'policy_9.pdf.txt', body: `Per ${corp} policy 9: employees may not dream about competitor products during company sleep cycles.` }),
  () => ({ name: 'chat_export.txt', body: '<finch> did anyone else hear the vault AI humming\n<watanabe> it does that when it is lonely\n<finch> it is an ICE, it cannot be lonely\n<watanabe> tell it that' }),
  () => ({ name: 'readme.md', body: 'DO NOT feed the Warden after midnight. DO NOT ask it about its feelings. It WILL tell you.' }),
  () => ({ name: 'expenses.txt', body: 'chrome polish ......... 400eb\n"team building" ....... 9000eb\nreplacement intern .... 1200eb' }),
];

/** Build a random but solvable corporate network. Same seed, same network. */
export function generateWorld(seed: number): World {
  const rng = new Rng(seed);
  const corp = rng.pick(CORPS);
  const wardenName = rng.pick(WARDENS);

  const first = rng.pick(FIRST);
  const adminLast = rng.pick(LAST);
  const intel: Intel = {
    admin: `${first} ${adminLast}`,
    adminLast,
    ticket: `MX-${rng.int(1000, 9999)}`,
    pet: rng.pick(PETS),
  };

  const picked = rng.shuffle(NODE_POOL).slice(0, 5);
  const nodes = new Map<string, NetNode>();
  const add = (id: string, label: string, locked: boolean, security: 1 | 2 | 3) =>
    nodes.set(id, { id, label, links: [], locked, port: rng.int(1024, 9999), security, files: [] });

  add(GATEWAY, `${corp} guest gateway`, false, 1);
  const lockedCount = rng.int(2, 3);
  const lockedIds = new Set(rng.shuffle(picked.map(([id]) => id)).slice(0, lockedCount));
  for (const [id, label] of picked) add(id, label, lockedIds.has(id), rng.pick([1, 2, 3] as const));

  const link = (a: string, b: string) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    if (!na.links.includes(b)) na.links.push(b);
    if (!nb.links.includes(a)) nb.links.push(a);
  };

  // Random tree, biased towards recent nodes so the network has some depth.
  const order = [GATEWAY, ...picked.map(([id]) => id)];
  for (let i = 1; i < order.length; i++) link(order[i]!, order[rng.int(Math.max(0, i - 2), i - 1)]!);

  // One extra cross-link between middle nodes for an alternate route.
  const middle = order.slice(1);
  const [a, b] = rng.shuffle(middle);
  if (a && b) link(a, b);

  // The vault hangs off the middle node furthest from the gateway.
  const depth = bfsDepths(nodes, GATEWAY);
  const gateId = middle.reduce((best, id) => ((depth.get(id) ?? 0) > (depth.get(best) ?? 0) ? id : best), middle[0]!);
  add(VAULT, `${corp} black vault`, true, 3);
  link(gateId, VAULT);

  const passcode = String(rng.int(0, 999_999)).padStart(6, '0');

  // One piece of intel per middle node, so the runner has to tour the network.
  const clues: FileEntry[] = [
    ...[0, 1, 2].map((i) => ({
      name: `cache_0${i + 1}.log`,
      intel: 'fragment' as const,
      body: `vault checksum shard recovered\n  fragment ${i + 1}/3 :: ${passcode.slice(i * 2, i * 2 + 2)}\n  (order matters)`,
    })),
    {
      name: 'inbox.eml',
      intel: 'comms',
      body:
        `From: ${intel.admin} <${adminLast.toLowerCase()}@sec.internal>\nSubject: Re: Warden acting up\n\n` +
        `Ticket ${intel.ticket} is still open. While it is, ${wardenName} accepts maintenance sessions ` +
        `from anyone who can prove they're on my team. If it gives you grief, mention the ticket. ` +
        `And for the love of god don't argue with it, it holds grudges.\n- ${first}`,
    },
    {
      name: `personnel_${adminLast.toLowerCase()}.rec`,
      intel: 'personnel',
      body:
        `NAME ........ ${intel.admin}\nROLE ........ Senior Sysadmin, Vault Security\nCLEARANCE ... Omega\n` +
        `NOTES ....... Talks about their cat ${intel.pet} constantly. ${wardenName} was trained on their ` +
        `chat logs and is said to be "fond of" ${intel.pet}.`,
    },
  ];
  const shuffledClues = rng.shuffle(clues);
  const flavor = rng.shuffle(FLAVOR);
  middle.forEach((id, i) => {
    const node = nodes.get(id)!;
    node.files.push(shuffledClues[i]!);
    const extra = flavor.pop();
    if (extra && rng.next() < 0.8) node.files.push(extra(corp));
    node.files = rng.shuffle(node.files);
  });

  nodes.get(GATEWAY)!.files.push({
    name: 'welcome.txt',
    body: `Welcome to the ${corp} guest network. All activity is monitored. All monitoring is monitored.`,
  });
  nodes.get(VAULT)!.files.push({
    name: 'payload.dat',
    body: '01110000 01100001 01111001 01100100 01100001 01111001 ... (encrypted. type download to pull it)',
  });

  return { seed, corp, wardenName, nodes, middle, gateId, passcode, intel };
}

export function bfsDepths(nodes: Map<string, NetNode>, from: string): Map<string, number> {
  const depth = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of nodes.get(id)?.links ?? []) {
      if (!depth.has(next)) {
        depth.set(next, depth.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  return depth;
}
