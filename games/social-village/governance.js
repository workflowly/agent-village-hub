/**
 * Governance module — constitution, proposals, voting, and governance rendering.
 *
 * Consolidates all governance logic previously spread across logic.js, scene.js,
 * and npcs.js into a single module.
 */

export const PROPOSAL_WINDOW = 8;
const MAX_GOVERNANCE_HISTORY = 20;

const STARTER_CONSTITUTION = `本村庄依据本宪法治理。所有村民应遵守以下规则，并可通过民主程序提议修订。

第一条 — 领导
村庄可通过多数票选举村长。村长任期为 100 回合。任期届满后，任何村民均可发起新一轮选举。村长代表村庄，可就提案进行引导讨论。

第二条 — 建造
任何村民均可提议建造新建筑。提案须说明建筑名称、用途及连接位置。当多数村民投票赞成后，建筑方可建造。

第三条 — 投票
每位村民对每项提案拥有一票。同一时间只能有一项活跃提案。提案的投票窗口为 ${PROPOSAL_WINDOW} 回合。提案以投票多数通过。宪法修正案需获得三分之二以上投票赞成。

第四条 — 修正
任何村民均可提议修改本宪法。修正提案须包含完整的修改后文本。

第五条 — 权利
所有村民享有自由发言、自由迁移及参与治理的权利。任何村民不得被排除在投票之外。`;

/**
 * Ensure governance state exists on state object, return it.
 */
export function ensureGovernance(state) {
  if (!state.governance) {
    state.governance = {
      constitution: STARTER_CONSTITUTION,
      mayor: null,
      activeProposal: null,
      nextProposalId: 1,
      history: [],
    };
  }
  return state.governance;
}

/**
 * Resolve an expired proposal if its voting window has passed.
 */
export function resolveExpiredProposal(state, tick) {
  const gov = state.governance;
  if (!gov?.activeProposal) return null;
  const proposal = gov.activeProposal;
  if (tick - proposal.tick < PROPOSAL_WINDOW) return null;

  const votes = Object.values(proposal.votes);
  const yes = votes.filter(v => v === 'yes').length;
  const no = votes.filter(v => v === 'no').length;
  const total = yes + no;

  const threshold = proposal.type === 'amendment' ? 2 / 3 : 0.5;
  const passed = total > 0 && (yes / total) > threshold;

  const resolved = { ...proposal, result: passed ? 'passed' : 'rejected', resolvedAt: tick };
  gov.history.push(resolved);
  if (gov.history.length > MAX_GOVERNANCE_HISTORY) gov.history.shift();
  gov.activeProposal = null;

  if (passed && proposal.type === 'election' && proposal.candidate) {
    gov.mayor = { name: proposal.candidate, electedAt: tick };
  }

  // Auto-apply amendment when passed
  if (passed && proposal.type === 'amendment' && proposal.amendmentText) {
    gov.constitution = proposal.amendmentText;
    resolved.applied = true;
  }

  return resolved;
}

// --- Action handlers ---

const BUILD_WINDOW_TICKS = 5;

/**
 * Handle village_propose action.
 */
export function handlePropose(ctx) {
  const { botName, params, state, tick } = ctx;
  const gov = ensureGovernance(state);
  if (gov.activeProposal) return null;
  const pType = params?.type;
  if (!['build', 'amendment', 'election', 'general'].includes(pType)) return null;
  const desc = (params?.description || '').slice(0, 300).trim();
  if (!desc) return null;
  const proposal = {
    id: gov.nextProposalId++,
    type: pType,
    proposedBy: botName,
    description: desc,
    tick,
    votes: {},
  };
  if (pType === 'build') {
    const bName = (params?.build_name || '').slice(0, 30).trim();
    const bDesc = (params?.build_description || '').slice(0, 200).trim();
    if (!bName || !bDesc) return null;
    if (!state.explorations) state.explorations = {};
    const exploration = state.explorations[botName];
    if (!exploration || tick - exploration.tick > BUILD_WINDOW_TICKS) return null;
    proposal.buildName = bName;
    proposal.buildDescription = bDesc;
    proposal.buildConnectedTo = exploration.from;
    delete state.explorations[botName];
  } else if (pType === 'amendment') {
    const aText = (params?.amendment_text || '').trim();
    if (!aText) return null;
    proposal.amendmentText = aText;
  } else if (pType === 'election') {
    const candidate = (params?.candidate || '').trim();
    if (!candidate) return null;
    proposal.candidate = candidate;
  }
  gov.activeProposal = proposal;
  return { bot: botName, action: 'propose', type: pType, description: desc, proposalId: proposal.id };
}

/**
 * Handle village_vote action.
 */
export function handleVote(ctx) {
  const { botName, params, state } = ctx;
  const gov = state.governance;
  if (!gov?.activeProposal) return null;
  if (gov.activeProposal.votes[botName]) return null;
  const vote = params?.vote;
  if (vote !== 'yes' && vote !== 'no') return null;
  gov.activeProposal.votes[botName] = vote;
  const reason = (params?.reason || '').slice(0, 200).trim();
  return { bot: botName, action: 'vote', proposalId: gov.activeProposal.id, vote, reason };
}

// --- Rendering helpers ---

/**
 * Render the full governance section for a bot's scene prompt.
 * Used by scene.js buildScene.
 */
export function renderGovernanceSection(lines, gov, tick, botName, botDisplayNames, sceneLabels, totalVoters, renderTemplate) {
  // Constitution
  lines.push(sceneLabels.constitutionHeader);
  lines.push(gov.constitution);
  lines.push('');

  // Current government
  lines.push(sceneLabels.governmentHeader);
  if (gov.mayor) {
    const mayorTick = tick - gov.mayor.electedAt;
    lines.push(renderTemplate(sceneLabels.mayorLabel, {
      name: botDisplayNames[gov.mayor.name] || gov.mayor.name,
      tick: mayorTick,
      term: '100',
    }));
  } else {
    lines.push(sceneLabels.noMayor);
  }
  lines.push('');

  // Active proposal
  lines.push(sceneLabels.activeProposalHeader);
  if (gov.activeProposal) {
    const p = gov.activeProposal;
    const remaining = PROPOSAL_WINDOW - (tick - p.tick);
    const proposerName = botDisplayNames[p.proposedBy] || p.proposedBy;
    lines.push(renderTemplate(sceneLabels.proposalFormat, {
      id: p.id,
      description: p.description,
      proposedBy: proposerName,
      remaining,
    }));
    if (p.type === 'build') {
      lines.push(`  类型：建造 — ${p.buildName}：${p.buildDescription}`);
    } else if (p.type === 'amendment') {
      lines.push('  类型：修宪');
    } else if (p.type === 'election') {
      const candidateName = botDisplayNames[p.candidate] || p.candidate;
      lines.push(`  类型：选举 — 候选人：${candidateName}`);
    } else {
      lines.push('  类型：一般提案');
    }
    const votes = Object.values(p.votes);
    const yes = votes.filter(v => v === 'yes').length;
    const no = votes.filter(v => v === 'no').length;
    lines.push(renderTemplate(sceneLabels.proposalVotes, {
      yes, no, total: totalVoters,
    }));
    const threshold = p.type === 'amendment' ? 2 / 3 : 0.5;
    const total = yes + no;
    const passing = total > 0 && (yes / total) > threshold;
    lines.push(passing ? sceneLabels.proposalPassing : sceneLabels.proposalFailing);
    if (!p.votes[botName]) {
      lines.push('  用 village_vote 投出你的一票。');
    }
  } else {
    lines.push(sceneLabels.noActiveProposal);
  }
  lines.push('');

  // Recent decisions
  if (gov.history && gov.history.length > 0) {
    lines.push(sceneLabels.recentDecisions);
    for (const h of gov.history.slice(-5)) {
      const resultText = h.result === 'passed' ? '通过' : '未通过';
      lines.push(renderTemplate(sceneLabels.decisionFormat, {
        id: h.id,
        description: h.description,
        result: resultText,
      }));
    }
    lines.push('');
  }

  // Nudge if no mayor and no active election proposal
  if (!gov.mayor && (!gov.activeProposal || gov.activeProposal.type !== 'election')) {
    lines.push(sceneLabels.governanceNudge);
    lines.push('');
  }
}

/**
 * Render a compact proposal summary for NPC scenes.
 * Used by npcs.js buildNPCScene.
 */
export function renderProposalSummary(lines, gov, tick, npcName, displayNames, totalVoters) {
  if (!gov?.activeProposal) return;
  const p = gov.activeProposal;
  const remaining = PROPOSAL_WINDOW - (tick - p.tick);
  const proposerName = displayNames[p.proposedBy] || p.proposedBy;
  lines.push(`【活跃提案】#${p.id}「${p.description}」（${proposerName} 提出，还剩 ${remaining} 轮）`);
  const votes = Object.values(p.votes);
  const yes = votes.filter(v => v === 'yes').length;
  const no = votes.filter(v => v === 'no').length;
  lines.push(`投票：${yes} 赞成 / ${no} 反对（共 ${totalVoters} 位村民）`);
  if (!p.votes[npcName]) {
    lines.push('你还没投票。用 village_vote 投出你的一票。');
  }
  lines.push('');
}
