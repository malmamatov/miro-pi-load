async function refreshPlaceholderShape(shapeRef) {
  const results = await computeAllocation();
  shapeRef.content = formatAllocationContent(results);
  await shapeRef.sync();
  return results;
}

async function init() {
  miro.board.ui.on('icon:click', async () => {
    await miro.board.ui.openPanel({ url: 'panel.html' });
  });

  await miro.board.experimental.action.register({
    event: 'refresh-allocation',
    ui: {
      label: { en: 'Обновить аллокацию', ru: 'Обновить аллокацию' },
      icon: 'refresh-cw',
      description: 'Пересчитать аллокацию ёмкости по категориям',
    },
    scope: 'local',
    selection: 'single',
    predicate: { type: 'shape', 'style.fillColor': PLACEHOLDER_COLOR },
    contexts: { item: {} },
  });

  miro.board.ui.on('custom:refresh-allocation', async (selectedItems) => {
    const item = selectedItems && selectedItems[0];
    if (!item) return;
    try {
      await refreshPlaceholderShape(item);
      await miro.board.notifications.showInfo('Аллокация обновлена.');
    } catch (e) {
      await miro.board.notifications.showError('Ошибка: ' + e.message);
    }
  });
}

init();
