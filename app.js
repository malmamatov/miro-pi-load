function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

function norm(items, type) {
  return items.map((it) => ({
    id: it.id,
    type,
    x: it.x,
    y: it.y,
    w: it.width,
    h: it.height,
    content: stripHtml(it.content),
    ref: it,
  }));
}

async function recalc() {
  const shapes = await miro.board.get({ type: 'shape' });
  const texts = await miro.board.get({ type: 'text' });
  const stickies = await miro.board.get({ type: 'sticky_note' });

  const all = [...norm(shapes, 'shape'), ...norm(texts, 'text'), ...norm(stickies, 'sticky_note')];

  const iterHeaders = all
    .filter((it) => it.type === 'text' && it.content.startsWith('Итерация'))
    .sort((a, b) => a.x - b.x);

  if (iterHeaders.length === 0) {
    await miro.board.notifications.showError('Не найдены заголовки итераций ("Итерация X.Y") на доске');
    return;
  }

  const centers = iterHeaders.map((it) => it.x);
  const bounds = centers.map((c, i) => {
    const left = i === 0 ? -Infinity : (centers[i - 1] + c) / 2;
    const right = i === centers.length - 1 ? Infinity : (c + centers[i + 1]) / 2;
    return [left, right];
  });

  const labelY = (text) => {
    const matches = all.filter((it) => it.type === 'shape' && it.content === text).map((it) => it.y);
    if (!matches.length) return null;
    return matches.reduce((a, b) => a + b, 0) / matches.length;
  };
  const capacityY = labelY('Емкость');
  const loadY = labelY('Загрузка');
  if (capacityY === null || loadY === null) {
    await miro.board.notifications.showError('Не найдены строки "Емкость"/"Загрузка" на доске');
    return;
  }

  const circles = all.filter((it) => it.type === 'shape' && it.w && it.w >= 100 && it.w <= 200);
  const nearestCircle = (targetY, left, right) => {
    const cands = circles.filter((c) => c.x >= left && c.x < right);
    if (!cands.length) return null;
    return cands.reduce((best, c) => (Math.abs(c.y - targetY) < Math.abs(best.y - targetY) ? c : best));
  };

  const storyCells = all.filter((it) => it.type === 'shape' && it.content === '' && it.h && it.h > 1500);
  if (!storyCells.length) {
    await miro.board.notifications.showError('Не найдена строка "Story" на доске');
    return;
  }
  const storyYMin = Math.min(...storyCells.map((c) => c.y - c.h / 2));
  const storyYMax = Math.max(...storyCells.map((c) => c.y + c.h / 2));

  const markers = all.filter(
    (it) =>
      (it.type === 'text' || it.type === 'sticky_note') &&
      it.y >= storyYMin &&
      it.y <= storyYMax &&
      /^\d+$/.test(it.content)
  );

  const results = [];
  for (let i = 0; i < bounds.length; i++) {
    const [left, right] = bounds[i];
    const colMarkers = markers.filter((m) => m.x >= left && m.x < right);
    const total = colMarkers.reduce((s, m) => s + parseInt(m.content, 10), 0);

    const loadCircle = nearestCircle(loadY, left, right);
    const capCircle = nearestCircle(capacityY, left, right);
    let capValue = null;
    if (capCircle && /^\d+$/.test(capCircle.content)) capValue = parseInt(capCircle.content, 10);

    const overloaded = capValue !== null && total > capValue;
    results.push({ label: iterHeaders[i].content, total, capValue, overloaded, loadCircle });
  }

  for (const r of results) {
    if (!r.loadCircle) continue;
    const shapeItem = r.loadCircle.ref;
    shapeItem.content = `<p>${r.total}</p>`;
    shapeItem.style.fillColor = r.overloaded ? '#df0b0b' : '#00a656';
    await shapeItem.sync();
  }

  const overloadedList = results.filter((r) => r.overloaded).map((r) => r.label);
  if (overloadedList.length) {
    await miro.board.notifications.showError('Перегруз: ' + overloadedList.join(', '));
  } else {
    await miro.board.notifications.showInfo('Загрузка пересчитана. Перегрузов нет.');
  }
}

async function init() {
  miro.board.ui.on('icon:click', async () => {
    await recalc();
  });
}

init();
