// Testes das funções puras: computeState / iconFor (state-machine.js) e
// agentOf (agents.js). Rodam com `node --test` (nativo, sem dependências).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeState, iconFor, sortByUrgency } = require('../src/state-machine.js');
const { agentOf } = require('../src/agents.js');

const NOW = 1_800_000_000;                 // epoch fixo (testes determinísticos)
const state = (last_event, agoSec = 0) => ({ last_event, last_event_ts: NOW - agoSec });

test('computeState: eventos de processamento → amarelo/tool', () => {
  for (const e of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
    assert.deepEqual(computeState(state(e), NOW), { level: 'processing', reason: 'tool' }, e);
  }
});

test('computeState: razões explícitas de "precisa de você" → vermelho', () => {
  assert.deepEqual(computeState(state('PermissionRequest'), NOW), { level: 'awaiting', reason: 'permission' });
  assert.deepEqual(computeState(state('Question'), NOW), { level: 'awaiting', reason: 'question' });
  assert.deepEqual(computeState(state('PostToolUseFailure'), NOW), { level: 'awaiting', reason: 'error' });
  assert.deepEqual(computeState(state('Notification'), NOW), { level: 'awaiting', reason: 'question' }, 'sem tipo → vermelho conservador');
});

test('computeState: readAt rebaixa vermelho → read (cinza) quando cobre o evento', () => {
  // sessão vermelha por permissão, evento em NOW-10
  const s = state('PermissionRequest', 10);        // last_event_ts = NOW - 10
  // sem readAt → vermelho normal
  assert.deepEqual(computeState(s, NOW), { level: 'awaiting', reason: 'permission' });
  // readAt >= last_event_ts → LIDO (cinza), preserva a razão
  assert.deepEqual(computeState(s, NOW, null, NOW - 10), { level: 'read', reason: 'permission' });
  assert.deepEqual(computeState(s, NOW, null, NOW), { level: 'read', reason: 'permission' });
});

test('computeState: evento vermelho NOVO (ts > readAt) reacende', () => {
  // marcou lido em NOW-100, mas o evento é mais recente (NOW-5)
  const s = state('PostToolUseFailure', 5);        // last_event_ts = NOW - 5
  assert.deepEqual(computeState(s, NOW, null, NOW - 100), { level: 'awaiting', reason: 'error' },
    'notificação nova depois da marca → volta a vermelho');
});

test('computeState: readAt NÃO afeta amarelo nem verde', () => {
  // processando (amarelo) nunca vira cinza
  assert.deepEqual(computeState(state('PreToolUse'), NOW, null, NOW), { level: 'processing', reason: 'tool' });
  // terminado (verde) nunca vira cinza
  assert.deepEqual(computeState(state('Stop'), NOW, null, NOW), { level: 'done', reason: 'ok' });
});

test('computeState: idle escalado (awaiting) também pode ser marcado lido', () => {
  // Stop antigo → escalou pra awaiting/idle; readAt cobrindo → read
  const s = state('Stop', 400);                    // > threshold default (300s)
  assert.deepEqual(computeState(s, NOW, null), { level: 'awaiting', reason: 'idle' });
  assert.deepEqual(computeState(s, NOW, null, NOW - 400), { level: 'read', reason: 'idle' });
});

test('iconFor: nível read → 👁', () => {
  assert.equal(iconFor({ level: 'read', reason: 'permission' }), '👁');
});

test('sortByUrgency: read vai pro fim (menos urgente que done)', () => {
  const mk = (level, ts) => ({ s: { last_event_ts: ts }, st: { level } });
  const out = sortByUrgency([mk('read', 100), mk('awaiting', 50), mk('done', 80), mk('processing', 90)]);
  assert.deepEqual(out.map((x) => x.st.level), ['awaiting', 'processing', 'done', 'read']);
});

test('computeState: Notification classifica por notification_type (não por message)', () => {
  const notif = (type) => ({ ...state('Notification'), notification_type: type });
  // benignos → verde (auth/elicitação concluída/respondida)
  for (const t of ['auth_success', 'elicitation_complete', 'elicitation_response']) {
    assert.deepEqual(computeState(notif(t), NOW), { level: 'done', reason: 'ok' }, `${t} → benigno`);
  }
  // precisa de você → vermelho
  for (const t of ['permission_prompt', 'idle_prompt', 'elicitation_dialog']) {
    assert.deepEqual(computeState(notif(t), NOW), { level: 'awaiting', reason: 'question' }, `${t} → vermelho`);
  }
  // tipo desconhecido → conservador vermelho (não arriscar falso verde)
  assert.deepEqual(computeState(notif('new_future_type'), NOW), { level: 'awaiting', reason: 'question' }, 'desconhecido → vermelho');
});

test('computeState: SessionStart → verde (não escala, mesmo antigo)', () => {
  assert.deepEqual(computeState(state('SessionStart'), NOW), { level: 'done', reason: 'ok' });
  assert.deepEqual(computeState(state('SessionStart', 9999), NOW), { level: 'done', reason: 'ok' });
});

test('computeState: Stop recente → verde', () => {
  assert.deepEqual(computeState(state('Stop', 10), NOW), { level: 'done', reason: 'ok' });
});

test('computeState: escalada idle só no Stop, limite 5min', () => {
  assert.deepEqual(computeState(state('Stop', 299), NOW), { level: 'done', reason: 'ok' }, 'abaixo do limite');
  assert.deepEqual(computeState(state('Stop', 301), NOW), { level: 'awaiting', reason: 'idle' }, 'acima do limite');
  // SessionEnd/SessionStart NÃO escalam mesmo idle
  assert.deepEqual(computeState(state('SessionEnd', 9999), NOW), { level: 'done', reason: 'ok' });
});

test('computeState: evento desconhecido → verde conservador', () => {
  assert.deepEqual(computeState(state('ativo'), NOW), { level: 'done', reason: null });
});

test('sortByUrgency: vermelhos no topo; dentro de awaiting a mais antiga primeiro', () => {
  const mk = (level, ts) => ({ s: { last_event_ts: ts }, st: { level } });
  // verde novo (100), vermelho recente (200), amarelo (300), vermelho antigo (50)
  const ranked = [mk('done', 100), mk('awaiting', 200), mk('processing', 300), mk('awaiting', 50)];
  const out = sortByUrgency(ranked).map((r) => `${r.st.level}:${r.s.last_event_ts}`);
  assert.deepEqual(out, ['awaiting:50', 'awaiting:200', 'processing:300', 'done:100'], '🔴(antigo) → 🔴(novo) → 🟡 → 🟢');
});

test('sortByUrgency: não muta o array original', () => {
  const ranked = [{ s: { last_event_ts: 2 }, st: { level: 'done' } }, { s: { last_event_ts: 1 }, st: { level: 'awaiting' } }];
  const snap = ranked.map((r) => r.st.level);
  sortByUrgency(ranked);
  assert.deepEqual(ranked.map((r) => r.st.level), snap, 'original intacto');
});

test('sortByUrgency: dentro de done/processing o mais recente vem primeiro', () => {
  const ranked = [
    { s: { last_event_ts: 10 }, st: { level: 'done' } },
    { s: { last_event_ts: 90 }, st: { level: 'done' } },
  ];
  assert.deepEqual(sortByUrgency(ranked).map((r) => r.s.last_event_ts), [90, 10], 'recente antes');
});

test('iconFor: cada reason tem seu ícone; fallback por level', () => {
  assert.equal(iconFor({ level: 'awaiting', reason: 'permission' }), '🔑');
  assert.equal(iconFor({ level: 'awaiting', reason: 'error' }), '⚠');
  assert.equal(iconFor({ level: 'awaiting', reason: 'question' }), '❓');
  assert.equal(iconFor({ level: 'awaiting', reason: 'idle' }), '⏰');
  assert.equal(iconFor({ level: 'processing', reason: 'tool' }), '🛠');
  assert.equal(iconFor({ level: 'done', reason: 'ok' }), '✓');
  assert.equal(iconFor({ level: 'processing', reason: null }), '🛠', 'fallback processing');
  assert.equal(iconFor({ level: 'done', reason: null }), '✓', 'fallback done');
});

test('agentOf: resolve agente conhecido, cai no default (claude) senão', () => {
  assert.equal(agentOf({ agent: 'claude' }), 'claude');
  assert.equal(agentOf({ agent: 'antigravity' }), 'antigravity');
  assert.equal(agentOf({ agent: 'opencode' }), 'opencode');
  assert.equal(agentOf({ agent: 'inexistente' }), 'claude', 'agente fora do registro → default');
  assert.equal(agentOf({}), 'claude', 'sem campo agent (state v1) → default');
  assert.equal(agentOf(null), 'claude', 'null → default');
});
