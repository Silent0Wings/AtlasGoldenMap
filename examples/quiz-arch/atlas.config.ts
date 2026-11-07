/**
 * Worked example: the original Quiz Arch map, ported to the generic API.
 *
 * To use it, copy this folder's parent tool into quiz-arch/ignore/ui-atlas/ and
 * replace the root atlas.config.ts with this file (fix the import path to './core/atlas').
 * Nodes are generated from the app's own data (quizzes/manifest.json), so new topics
 * and quizzes are picked up automatically.
 */
import fs from 'fs';
import path from 'path';
import { defineAtlas, click, check, seq, clickUntil, slug, ATLAS_ROOT, type UINode, type Page } from '../../core/atlas';

const REPO = path.resolve(ATLAS_ROOT, '..', '..');   // atlas lives in <repo>/ignore/ui-atlas
const PORT = 8091;

type Quiz = { id: string; title: string; path: string; category: string; tag: string };
type Topic = { id: string; title: string; icon: string; description: string; quizzes: Quiz[] };

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/^﻿/, ''));
const questionsOf = (p: string): any[] => { try { const d = readJson(p); return (d.quiz || d).questions || []; } catch { return []; } };

function topics(): Topic[] {
  return readJson('quizzes/manifest.json').topics.map((t: any) => {
    const cfg = readJson(t.config);
    return {
      id: t.id, title: cfg.title, icon: cfg.icon, description: cfg.description,
      // same id the collection emits for this card: <idPrefix>:<slug of .quiz-title>
      quizzes: cfg.quizzes.map((q: any) => ({ id: `quiz:${t.id}:${slug(q.title)}`, title: q.title, path: q.path, category: q.category, tag: q.tag })),
    };
  });
}

/** Prefer a quiz whose first question shows an image or code block; else the first quiz. */
const pickSample = (t: Topic) =>
  t.quizzes.find(q => { const q0 = questionsOf(q.path)[0]; return q0 && (q0.image || q0.code_block); }) ?? t.quizzes[0];

/** Learner profile: per topic, quiz 1 completed at 100%, quiz 2 at 40% with missed questions. */
function buildSession(ts: Topic[]) {
  const at = '2026-11-01T12:00:00.000Z';
  const quiz_history: Record<string, any> = {};
  for (const t of ts) t.quizzes.slice(0, 2).forEach((q, i) => {
    const qs = questionsOf(q.path).slice(0, 5);
    const answers = qs.map((x, j) => ({ qid: x.id, selected: 'a', correct: i === 0 || j < 2, time_ms: 4000 }));
    const correct = answers.filter(a => a.correct).length;
    const score = qs.length ? Math.round((correct / qs.length) * 100) : 0;
    quiz_history[q.path] = { attempts: [{ started_at: at, completed_at: at, score, correct_count: correct, total_questions: qs.length, time_seconds: 120, answers }],
      best_score: score, best_time_seconds: 120, status: 'completed' };
  });
  return { version: '1.0', created_at: at, last_active: at, user_alias: 'Golden',
    stats: { total_quizzes_completed: ts.length * 2, total_questions_answered: 70, total_correct: 49, total_time_seconds: 1680,
      current_streak_days: 3, longest_streak_days: 7, last_study_date: '2026-11-01' },
    quiz_history, topic_progress: {}, achievements: [] };
}

const DASH = '/src/dashboard.html';
const TOPICS = topics();

function nodes(): UINode[] {
  const N: UINode[] = [
    { id: 'dashboard', label: 'Dashboard (hub)', kind: 'page', url: DASH, fixture: 'session',
      tags: ['home', 'hub', 'topics'], ready: '.topic-card',
      components: [
        { name: 'app-header', label: 'App header', selector: 'header.app-header' },
        { name: 'dashboard-header', label: 'Dashboard header', selector: 'header.dashboard-header' },
        { name: 'global-stats', label: 'Global stats', selector: '#globalStatsContainer' },
        { name: 'search', label: 'Search box', selector: '#searchInput' },
        { name: 'topic-card', label: 'Topic card', selector: '.topic-card' },
        { name: 'drop-zone', label: 'Drop zone', selector: '#dropZone' },
      ] },
    { id: 'dashboard:fresh', label: 'Dashboard — no progress', kind: 'state', parent: 'dashboard', url: DASH,
      tags: ['empty', 'new user', 'clean'], ready: '.topic-card' },
    { id: 'dashboard:profile', label: 'Learner profile popover', kind: 'state', parent: 'dashboard',
      steps: click('#profileToggleBtn'), ready: '#sessionSettingsContainer .session-settings-box', tags: ['profile', 'session', 'settings', 'reset'],
      components: [{ name: 'settings-box', label: 'Session settings box', selector: '#sessionSettingsContainer' }] },
    { id: 'dashboard:filters', label: 'Topic filters', kind: 'state', parent: 'dashboard',
      steps: click('#filterToggleBtn'), ready: '#filterSection', tags: ['filter', 'category'],
      components: [{ name: 'filter-section', label: 'Filter panel', selector: '#filterSection' }] },
    { id: 'dashboard:graph', label: 'Dashboard graph view', kind: 'state', parent: 'dashboard',
      steps: click('#viewModeGraphBtn'), ready: '#dashboardGraphCanvas', volatile: true, tags: ['graph', 'canvas', 'view mode'],
      components: [{ name: 'graph', label: 'Graph canvas', selector: '#dashboardGraphContainer' }] },
    { id: 'quiz-app', label: 'Manual quiz loader', kind: 'page', parent: 'dashboard', url: '/src/quiz-app.html',
      tags: ['load', 'upload', 'json', 'paste'], ready: '#load.active',
      components: [{ name: 'load-panel', label: 'Load panel', selector: '#load' }] },
  ];

  for (const t of TOPICS) {
    const tid = `topic:${t.id}`;
    N.push({ id: tid, label: `${t.icon} ${t.title}`, kind: 'page', parent: 'dashboard', group: t.id, fixture: 'session',
      url: `${DASH}?topic=${encodeURIComponent(t.id)}`, tags: ['topic', t.id, t.description], ready: '.quiz-card',
      timeout: 60_000 + t.quizzes.length * 3_000,
      collection: { selector: '#quizGrid .quiz-card', label: '.quiz-title', tags: ['.quiz-badge, .quiz-badge-target'], idPrefix: `quiz:${t.id}`, kind: 'item' },
      components: [
        { name: 'header', label: 'Topic header', selector: 'header.dashboard-header' },
        { name: 'stats', label: 'Topic stats', selector: '#globalStatsContainer' },
      ] });

    const s = pickSample(t);
    const ns = (k: string) => `${s.id}:${k}`;
    const tags = [t.id, t.title, s.title, 'player'];
    N.push(
      { id: ns('setup'), label: `Setup — ${s.title}`, kind: 'page', parent: s.id, group: t.id,
        url: `/src/launcher.html?quiz=/${s.path}&topic=${encodeURIComponent(t.id)}`, tags: [...tags, 'setup', 'options', 'timer'],
        ready: '#setup.active #startBtn',
        components: [
          { name: 'count-chips', label: 'Question count chips', selector: '#countChips' },
          { name: 'setup-card', label: 'Setup panel', selector: '#setup' },
        ] },
      { id: ns('question'), label: `Question — ${s.title}`, kind: 'page', parent: ns('setup'), tags: [...tags, 'question', 'options'],
        steps: seq(check('#randomizeQuestions', false), check('#randomizeAnswers', false), click('#startBtn')),
        ready: '#question.active #optionsContainer .option',
        components: [
          { name: 'progress', label: 'Progress bar', selector: '#progressBar' },
          { name: 'text', label: 'Question text', selector: '#questionText' },
          { name: 'image', label: 'Question image', selector: '#qImage' },
          { name: 'code', label: 'Code block', selector: '#qCodeBlock' },
          { name: 'options', label: 'Answer options', selector: '#optionsContainer' },
        ] },
      { id: ns('teleport'), label: `Question navigator — ${s.title}`, kind: 'state', parent: ns('question'), tags: [...tags, 'teleport', 'navigator', 'jump'],
        steps: click('#teleportToggleBtn'), ready: '#teleportPanel .teleport-btn',
        components: [{ name: 'panel', label: 'Teleport panel', selector: '#teleportPanel' }] },
      { id: ns('selected'), label: `Option selected — ${s.title}`, kind: 'state', parent: ns('question'), tags: [...tags, 'selected', 'answer'],
        steps: click('#optionsContainer label.option'), ready: '#optionsContainer .option.selected',
        components: [{ name: 'option', label: 'Selected option', selector: '#optionsContainer .option.selected' }] },
      { id: ns('feedback'), label: `Feedback — ${s.title}`, kind: 'page', parent: ns('selected'), tags: [...tags, 'feedback', 'verdict', 'explanation'],
        steps: click('#submitBtn'), ready: '#feedback.active #nextBtn',
        components: [
          { name: 'verdict', label: 'Verdict badge', selector: '#verdictWrap' },
          { name: 'options', label: 'Marked options', selector: '#fbOptions' },
          { name: 'explanation', label: 'Explanation block', selector: '#feedbackBlock' },
        ] },
      { id: ns('results'), label: `Results — ${s.title}`, kind: 'page', parent: ns('setup'), tags: [...tags, 'results', 'score', 'pass'],
        steps: click('#devSkipBtn'), ready: '#results.active',
        components: [
          { name: 'score', label: 'Score', selector: '#scoreBig' },
          { name: 'pass', label: 'Pass badge', selector: '#passBadge' },
          { name: 'highscore-entry', label: 'High-score entry', selector: '#highScoreEntry' },
        ] },
      { id: ns('review'), label: `Review — ${s.title}`, kind: 'page', parent: ns('results'), tags: [...tags, 'review', 'answers'],
        steps: click('#reviewBtn'), ready: '#review.active .review-card',
        components: [{ name: 'card', label: 'Review card', selector: '#reviewContainer .review-card' }] },
      { id: ns('highscores'), label: `High scores — ${s.title}`, kind: 'page', parent: ns('setup'), tags: [...tags, 'high scores', 'leaderboard'],
        steps: click('#viewHighScoresBtn'), ready: '#highscores.active',
        components: [{ name: 'table', label: 'High-score table', selector: '#hsTable' }] },
    );

    if (t === TOPICS[0]) {
      const modal = 'dialog.modal-dialog[open] .modal-content, .modal-overlay .modal-content';
      N.push(
        { id: `${tid}:reset-modal`, label: 'Reset quiz modal', kind: 'state', parent: tid,
          steps: click('.quiz-card .delete-quiz-btn'), ready: modal, tags: ['modal', 'delete', 'reset', 'confirm'],
          components: [{ name: 'modal', label: 'Modal dialog', selector: modal }] },
        { id: `${tid}:phone-qr`, label: 'Phone QR code', kind: 'state', parent: tid,
          steps: async (p: Page) => {   // Phone lives in the card's "More" menu in the current design
            const more = p.locator('.quiz-card .card-more summary').first();
            if (await more.isVisible()) await more.click();
            await p.locator('.quiz-card .phone-btn').first().click();
          },
          ready: '.phone-qr-wrap .qr-container', tags: ['qr', 'phone', 'mobile'],
          components: [{ name: 'qr', label: 'QR panel', selector: '.phone-qr-wrap' }] },
        { id: 'editor', label: `Quiz editor — ${s.title}`, kind: 'page', parent: s.id, group: t.id,
          url: `/src/editor.html?quiz=/${s.path}`, ready: '#jsonEditor', tags: ['editor', 'json', 'authoring'],
          components: [
            { name: 'json', label: 'JSON editor', selector: '#jsonEditor' },
            { name: 'console', label: 'Problems console', selector: '#problemsConsole' },
          ] },
        { id: 'editor:search', label: 'Editor search & replace', kind: 'state', parent: 'editor',
          // the editor wires #toggleSearchBtn after it loads the quiz: retry until the bar opens
          steps: clickUntil('#toggleSearchBtn', '#searchReplaceBar'), ready: '#searchReplaceBar', tags: ['editor', 'search', 'replace'],
          components: [{ name: 'bar', label: 'Search bar', selector: '#searchReplaceBar' }] },
      );
    }
  }
  return N;
}

export default defineAtlas({
  title: 'Quiz Arch',
  baseURL: `http://127.0.0.1:${PORT}`,
  server: { staticDir: REPO, port: PORT, url: `http://127.0.0.1:${PORT}${DASH}` },
  variants: [
    { name: 'light', label: 'Light', colorScheme: 'light', localStorage: { 'quiz-arch-theme': 'light' } },
    { name: 'dark', label: 'Dark', colorScheme: 'dark', localStorage: { 'quiz-arch-theme': 'dark' } },
  ],
  nodes,
  root: 'dashboard',
  fixtures: { session: { localStorage: { quiz_arch_session: JSON.stringify(buildSession(TOPICS)) } } },
  mask: ['#qTimer', '#statusText'],
  freezeCss: 'body > canvas{visibility:hidden!important}  /* canvas-confetti overlay */',
  clock: '2026-11-01T12:00:00Z',
  textSelectors: ['h1', 'h2', 'h3', '.screen.active .card-title', '#questionText'],
  groups: Object.fromEntries(TOPICS.map(t => [t.id, `${t.icon} ${t.title}`])),
  labels: { item: 'quiz card', items: 'quiz cards' },
  workers: 6,
});
