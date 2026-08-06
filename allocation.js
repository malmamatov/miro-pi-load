const ALLOCATION_CATEGORIES = [
  'Стратегический эпик',
  'Эпики поезда (BAU)',
  'Регуляторные требования',
  'Инфраструктурные и архитектурные улучшения',
  'Баги и техническая поддержка',
  'Не указано',
];
const LOW_REGULATORY_THRESHOLD = 10; // %
const REGULATORY_CATEGORY = 'Регуляторные требования';

const FEATURE_COLOR = '#2d9bf0';
const STORY_COLOR = '#8fd14f';
const PLACEHOLDER_COLOR = '#c9b3f0';
const BRACKET_RE = /\[(.*?)\]/;

function stripHtml(s) {
  const div = document.createElement('div');
  div.innerHTML = s || '';
  return (div.textContent || div.innerText || '').trim();
}

function rowYRange(shapes, minH, maxH) {
  const cells = shapes.filter(
    (s) => stripHtml(s.content) === '' && s.height && s.height >= minH && s.height <= maxH
  );
  if (!cells.length) return null;
  const yMin = Math.min(...cells.map((c) => c.y - c.height / 2));
  const yMax = Math.max(...cells.map((c) => c.y + c.height / 2));
  return [yMin, yMax];
}

const _tagValueCache = new Map();
async function numericTagValue(tagId) {
  if (_tagValueCache.has(tagId)) return _tagValueCache.get(tagId);
  let value = null;
  try {
    const tag = await miro.board.getById(tagId);
    const title = (tag.title || '').trim();
    if (/^\d+$/.test(title)) value = parseInt(title, 10);
  } catch (e) {
    value = null;
  }
  _tagValueCache.set(tagId, value);
  return value;
}

// Story points come from numeric tags on cards (e.g. "1", "2", "3", "5", "8", "13"...).
// A card with several numeric tags counts all of them.
async function getPointsByCard(cards) {
  const pointsByCard = new Map();
  for (const card of cards) {
    let sum = 0;
    for (const tagId of card.tagIds || []) {
      const v = await numericTagValue(tagId);
      if (v !== null) sum += v;
    }
    if (sum > 0) pointsByCard.set(card.id, sum);
  }
  return pointsByCard;
}

function zoneOf(featureRange, storyRange, y) {
  if (y === null || y === undefined) return null;
  if (y >= featureRange[0] && y <= featureRange[1]) return 'feature';
  if (y >= storyRange[0] && y <= storyRange[1]) return 'story';
  return null;
}

function colorZone(color) {
  if (color === FEATURE_COLOR) return 'feature';
  if (color === STORY_COLOR) return 'story';
  return null;
}

async function computeAllocation() {
  const shapes = await miro.board.get({ type: 'shape' });
  const featureRange = rowYRange(shapes, 700, 1200);
  const storyRange = rowYRange(shapes, 1500, 3000);
  if (!featureRange || !storyRange) throw new Error('Не найдены строки "Feature"/"Story" на доске');

  const zone = (y) => zoneOf(featureRange, storyRange, y);

  const cards = await miro.board.get({ type: 'card' });
  const pointsByCard = await getPointsByCard(cards);

  const connectors = await miro.board.get({ type: 'connector' });
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const featureToStories = new Map();
  for (const conn of connectors) {
    const startId = conn.start && conn.start.item;
    const endId = conn.end && conn.end.item;
    if (!startId || !endId) continue;
    const startCard = cardById.get(startId);
    const endCard = cardById.get(endId);

    const startZone =
      (startCard && colorZone(startCard.style && startCard.style.cardTheme)) || zone(startCard && startCard.y);
    const endZone =
      (endCard && colorZone(endCard.style && endCard.style.cardTheme)) || zone(endCard && endCard.y);

    let featureId = null;
    let storyId = null;
    if (startZone === 'feature' && endZone === 'story') {
      featureId = startId;
      storyId = endId;
    } else if (startZone === 'story' && endZone === 'feature') {
      featureId = endId;
      storyId = startId;
    } else {
      continue;
    }
    if (!featureToStories.has(featureId)) featureToStories.set(featureId, []);
    featureToStories.get(featureId).push(storyId);
  }

  const categoryTotals = {};
  for (const cat of ALLOCATION_CATEGORIES) categoryTotals[cat] = 0;

  const linkedStoryIds = new Set();
  for (const [featureId, storyIds] of featureToStories.entries()) {
    storyIds.forEach((id) => linkedStoryIds.add(id));
    const featureCard = cardById.get(featureId);
    const title = stripHtml((featureCard && featureCard.title) || '');
    const m = BRACKET_RE.exec(title);
    let category = 'Не указано';
    if (m) {
      const bracketText = m[1].trim().toLowerCase();
      const matched = ALLOCATION_CATEGORIES.find((c) => c.toLowerCase() === bracketText);
      if (matched) category = matched;
    }
    const spSum = storyIds.reduce((s, id) => s + (pointsByCard.get(id) || 0), 0);
    categoryTotals[category] += spSum;
  }

  for (const card of cards) {
    if (linkedStoryIds.has(card.id)) continue;
    const sp = pointsByCard.get(card.id);
    if (!sp) continue;
    const cardZone = colorZone(card.style && card.style.cardTheme) || zone(card.y);
    if (cardZone === 'story') categoryTotals['Не указано'] += sp;
  }

  const total = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  return ALLOCATION_CATEGORIES.map((cat) => {
    const sp = categoryTotals[cat];
    const pct = total > 0 ? Math.round((sp / total) * 100) : 0;
    return { category: cat, sp, pct };
  });
}

function formatAllocationContent(results) {
  const lines = ['<p><strong>Аллокация ёмкости</strong></p>'];
  for (const r of results) {
    const low = r.category === REGULATORY_CATEGORY && r.pct < LOW_REGULATORY_THRESHOLD;
    const line = `${r.category}: ${r.sp} SP (${r.pct}%)`;
    lines.push(low ? `<p><span style="color:#df0b0b">${line}</span></p>` : `<p>${line}</p>`);
  }
  const now = new Date();
  const stamp = now.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  lines.push(`<p><span style="font-size:10px;color:#888888">Обновлено: ${stamp}</span></p>`);
  return lines.join('');
}
