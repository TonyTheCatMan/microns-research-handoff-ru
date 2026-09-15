/* Assets are read from this website on demand. No local package selection is needed. */
(() => {
  'use strict';
  const root = new URL('./', location.href);
  function urlFor(path) {
    const url = new URL(path, root);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error('Недопустимый путь к материалам.');
    return url;
  }
  async function read(path, text = false, signal) {
    try {
      const response = await fetch(urlFor(path), {signal});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return text ? await response.text() : await response.arrayBuffer();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Не удалось загрузить ' + path + '. Проверьте соединение и повторите загрузку.');
    }
  }
  window.HandoffAssets = {read, file: path => ({name: path.split('/').pop(), onlinePath: path})};
})();
